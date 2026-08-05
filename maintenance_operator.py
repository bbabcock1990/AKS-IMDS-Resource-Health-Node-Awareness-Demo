"""Central maintenance operator for the AKS maintenance demo.

Closes the gaps the per-node controller leaves open by acting as a small
"control plane" component:

  #1 Subscription-list polling      -> poll a prod/dev subscription list and read
                                       Resource Health-shaped signals for each.
  #2 VMSS instance -> node mapping   -> each signal carries the resolved node; the
                                       operator drives the DaemonSet controller for
                                       that node.
  #3 Persistent normalized store     -> SQLite on a PersistentVolume holding
                                       normalized events + full action history.
  #4 Deduplication                   -> incoming signals/transitions are de-duped
                                       against stored records.
  #6 Hardware-failure detection      -> Degraded/Unavailable signals fire a Teams
                                       notification and cordon/drain the node.
  #8 Operator visibility             -> an HTTP dashboard + JSON API listing
                                       upcoming actions, events and dedup counts.

In production the poller would call Azure Resource Health
(``.../providers/Microsoft.ResourceHealth/availabilityStatuses``) across each
configured subscription using workload identity. For a small, self-contained
demo the same loop reads Resource Health-shaped signals from a ConfigMap so we
can inject a "Degraded" hardware event on demand. The normalization, dedup,
persistence, notification and cordon/drain wiring are identical either way.
"""

import json
import logging
import os
import sqlite3
import threading
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import requests
from kubernetes import client, config
from kubernetes.client.rest import ApiException

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s %(message)s",
)

NAMESPACE = os.getenv("POD_NAMESPACE", "aks-maintenance-demo")
POLL_SECONDS = int(os.getenv("POLL_SECONDS", "5"))
HTTP_PORT = int(os.getenv("HTTP_PORT", "8080"))
DB_PATH = os.getenv("DB_PATH", "/data/maintenance.db")
WEBHOOK_URL = os.getenv("NOTIFICATION_WEBHOOK_URL", "")
DEMO_CONFIGMAP = os.getenv("DEMO_CONFIGMAP", "maintenance-demo-events")
SUBSCRIPTIONS_CONFIGMAP = os.getenv("SUBSCRIPTIONS_CONFIGMAP", "maintenance-subscriptions")
SIGNALS_CONFIGMAP = os.getenv("SIGNALS_CONFIGMAP", "maintenance-resource-health")
DRIVE_CORDON = os.getenv("DRIVE_CORDON", "true").lower() == "true"
DEGRADED_STATES = {"Degraded", "Unavailable"}

try:
    config.load_incluster_config()
    core = client.CoreV1Api()
except config.ConfigException:  # allows local unit testing off-cluster
    core = None

_db_lock = threading.Lock()


def now_iso():
    return datetime.now(timezone.utc).isoformat()


# --------------------------------------------------------------------------- #
# Persistent store (#3)
# --------------------------------------------------------------------------- #
def db_connect():
    connection = sqlite3.connect(DB_PATH, timeout=10)
    connection.row_factory = sqlite3.Row
    return connection


def init_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    with _db_lock, db_connect() as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS events (
                event_id     TEXT PRIMARY KEY,
                subscription TEXT,
                environment  TEXT,
                target_node  TEXT,
                event_type   TEXT,
                source       TEXT,
                availability TEXT,
                not_before   TEXT,
                description  TEXT,
                first_seen   TEXT,
                last_seen    TEXT,
                last_state   TEXT,
                dedup_count  INTEGER DEFAULT 1
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS history (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                event_id   TEXT,
                node       TEXT,
                state      TEXT,
                detail     TEXT,
                source     TEXT,
                ts         TEXT
            )
            """
        )
        connection.commit()
    logging.info("Store initialised at %s", DB_PATH)


def record_history(message):
    """Persist one action-history row (a controller/operator state transition)."""
    with _db_lock, db_connect() as connection:
        connection.execute(
            "INSERT INTO history (event_id, node, state, detail, source, ts) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (
                message.get("eventId"),
                message.get("node"),
                message.get("state"),
                message.get("detail", ""),
                message.get("source"),
                now_iso(),
            ),
        )
        row = connection.execute(
            "SELECT event_id FROM events WHERE event_id = ?",
            (message.get("eventId"),),
        ).fetchone()
        if row:
            connection.execute(
                "UPDATE events SET last_state = ?, last_seen = ? WHERE event_id = ?",
                (message.get("state"), now_iso(), message.get("eventId")),
            )
        connection.commit()


def upsert_event(event):
    """Insert a normalized event, or bump its dedup counter if already stored (#4).

    Returns True when the event is newly stored (first time seen).
    """
    with _db_lock, db_connect() as connection:
        existing = connection.execute(
            "SELECT event_id FROM events WHERE event_id = ?",
            (event["eventId"],),
        ).fetchone()
        if existing:
            connection.execute(
                "UPDATE events SET dedup_count = dedup_count + 1, last_seen = ? "
                "WHERE event_id = ?",
                (now_iso(), event["eventId"]),
            )
            connection.commit()
            return False
        connection.execute(
            """
            INSERT INTO events (event_id, subscription, environment, target_node,
                event_type, source, availability, not_before, description,
                first_seen, last_seen, last_state, dedup_count)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
            """,
            (
                event["eventId"],
                event.get("subscription", ""),
                event.get("environment", ""),
                event.get("targetNode", ""),
                event.get("eventType", ""),
                event.get("source", ""),
                event.get("availability", ""),
                event.get("notBefore", ""),
                event.get("description", ""),
                now_iso(),
                now_iso(),
                "Detected",
            ),
        )
        connection.commit()
        return True


# --------------------------------------------------------------------------- #
# Notifications (#6) and cordon wiring (#2/#5)
# --------------------------------------------------------------------------- #
def notify(event, state, detail=""):
    message = {
        "node": event.get("targetNode", ""),
        "eventId": event["eventId"],
        "eventType": event.get("eventType", ""),
        "source": event.get("source", "AzureResourceHealth"),
        "state": state,
        "detail": detail,
    }
    logging.info("HARDWARE_EVENT %s", json.dumps(message, sort_keys=True))
    record_history(message)
    if WEBHOOK_URL:
        try:
            requests.post(WEBHOOK_URL, json=message, timeout=5).raise_for_status()
        except requests.RequestException as exc:
            logging.error("Notification webhook failed: %s", exc)


def drive_cordon(event):
    """Hand the event to the DaemonSet controller by writing the node event
    ConfigMap, so the existing cordon/drain path runs for the mapped node."""
    payload = {
        "eventId": event["eventId"],
        "targetNode": event["targetNode"],
        "eventType": event["eventType"],
        "eventStatus": "Scheduled",
        "source": event.get("source", "AzureResourceHealth"),
        "notBefore": event.get("notBefore", ""),
        "leadSeconds": event.get("leadSeconds", 0),
        "description": event.get("description", ""),
    }
    body = {"data": {"event.json": json.dumps(payload)}}
    core.patch_namespaced_config_map(DEMO_CONFIGMAP, NAMESPACE, body)
    logging.info(
        "Drove cordon for node %s via ConfigMap %s", event["targetNode"], DEMO_CONFIGMAP
    )


# --------------------------------------------------------------------------- #
# Subscription-list polling (#1)
# --------------------------------------------------------------------------- #
def read_configmap_json(name, key):
    if core is None:
        return None
    try:
        configmap = core.read_namespaced_config_map(name, NAMESPACE)
    except ApiException as exc:
        if exc.status != 404:
            logging.warning("Unable to read ConfigMap %s: %s", name, exc.reason)
        return None
    raw = (configmap.data or {}).get(key, "").strip()
    if not raw:
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        logging.error("ConfigMap %s/%s is not valid JSON: %s", name, key, exc)
        return None


def get_subscriptions():
    """The prod/dev subscription lists we poll (analogous to the real
    subscription list helpers)."""
    data = read_configmap_json(SUBSCRIPTIONS_CONFIGMAP, "subscriptions.json")
    return data or {"prod": [], "dev": []}


def normalize_signal(signal, subscription, environment):
    """Map a Resource Health-shaped availabilityStatus into our event schema."""
    props = signal.get("properties", signal)
    availability = props.get("availabilityState", "Unknown")
    event_type = (
        "HardwareFailure" if availability == "Unavailable" else "HardwareDegraded"
    )
    return {
        "eventId": signal.get("id")
        or signal.get("name")
        or f"{subscription}-{signal.get('resourceId', 'unknown')}",
        "subscription": subscription,
        "environment": environment,
        "targetNode": signal.get("targetNode", ""),
        "eventType": event_type,
        "source": "AzureResourceHealth",
        "availability": availability,
        "notBefore": signal.get("notBefore", ""),
        "leadSeconds": signal.get("leadSeconds", 0),
        "description": props.get("summary")
        or props.get("reasonType")
        or "Resource Health reported a hardware issue.",
    }


def poll_once():
    subscriptions = get_subscriptions()
    signals_doc = read_configmap_json(SIGNALS_CONFIGMAP, "signals.json") or {}
    signals = signals_doc.get("value", signals_doc.get("signals", []))
    sub_index = {
        sub: env
        for env, subs in subscriptions.items()
        for sub in subs
    }

    total = 0
    for signal in signals:
        subscription = signal.get("subscription") or (
            next(iter(sub_index), "") if sub_index else ""
        )
        environment = sub_index.get(subscription, signal.get("environment", "unknown"))
        availability = signal.get("properties", signal).get("availabilityState", "Available")
        if availability not in DEGRADED_STATES:
            continue
        total += 1
        event = normalize_signal(signal, subscription, environment)
        if not upsert_event(event):
            continue  # already processed -> dedup (#4)

        logging.info(
            "Detected %s on %s (sub=%s, env=%s)",
            event["eventType"],
            event["targetNode"] or "unmapped",
            subscription,
            environment,
        )
        notify(
            event,
            "HardwareFailureDetected",
            f"{availability} reported by Resource Health "
            f"(sub={subscription}, env={environment}).",
        )
        if DRIVE_CORDON and event["targetNode"]:
            try:
                drive_cordon(event)
            except ApiException as exc:
                logging.error("Failed to drive cordon: %s", exc.reason)
    return total


def poller_loop():
    logging.info(
        "Poller started: subscriptions=%s signals=%s every %ss",
        SUBSCRIPTIONS_CONFIGMAP,
        SIGNALS_CONFIGMAP,
        POLL_SECONDS,
    )
    subs = get_subscriptions()
    logging.info(
        "Polling %d prod + %d dev subscription(s)",
        len(subs.get("prod", [])),
        len(subs.get("dev", [])),
    )
    while True:
        try:
            poll_once()
        except Exception as exc:  # noqa: BLE001 - keep the loop alive
            logging.exception("Poll cycle failed: %s", exc)
        time.sleep(POLL_SECONDS)


# --------------------------------------------------------------------------- #
# Dashboard + API (#8)
# --------------------------------------------------------------------------- #
def query_events():
    with _db_lock, db_connect() as connection:
        rows = connection.execute(
            "SELECT * FROM events ORDER BY last_seen DESC"
        ).fetchall()
        return [dict(row) for row in rows]


def query_history(limit=100):
    with _db_lock, db_connect() as connection:
        rows = connection.execute(
            "SELECT * FROM history ORDER BY id DESC LIMIT ?", (limit,)
        ).fetchall()
        return [dict(row) for row in rows]


def query_upcoming():
    now = now_iso()
    upcoming = []
    for event in query_events():
        not_before = event.get("not_before") or ""
        if not_before and not_before > now and event.get("last_state") not in {
            "SimulatedComplete",
            "Acknowledged",
        }:
            upcoming.append(event)
    return upcoming


def render_dashboard():
    subs = get_subscriptions()
    events = query_events()
    history = query_history(50)
    upcoming = query_upcoming()

    def rows(items, columns):
        if not items:
            return "<tr><td colspan='%d'><em>none</em></td></tr>" % len(columns)
        out = []
        for item in items:
            cells = "".join(
                "<td>%s</td>" % (item.get(col, "") if item.get(col) is not None else "")
                for col in columns
            )
            out.append("<tr>%s</tr>" % cells)
        return "".join(out)

    sub_lines = "".join(
        "<li><b>%s</b>: %s</li>" % (env, ", ".join(ids) or "<em>none</em>")
        for env, ids in subs.items()
    )
    total_dedup = sum(max(0, e.get("dedup_count", 1) - 1) for e in events)

    return """<!doctype html>
<html><head><meta charset='utf-8'><meta http-equiv='refresh' content='5'>
<title>AKS Maintenance Operator</title>
<style>
 body {{ font-family: Segoe UI, Arial, sans-serif; margin: 24px; color: #1b1b1b; }}
 h1 {{ font-size: 20px; }} h2 {{ font-size: 15px; margin-top: 24px; }}
 table {{ border-collapse: collapse; width: 100%; font-size: 12px; }}
 th, td {{ border: 1px solid #ddd; padding: 5px 8px; text-align: left; }}
 th {{ background: #0078d4; color: #fff; }}
 .cards {{ display: flex; gap: 16px; margin: 12px 0; }}
 .card {{ background: #f3f2f1; border-radius: 8px; padding: 12px 18px; }}
 .card b {{ font-size: 22px; display: block; }}
 code {{ background: #f3f2f1; padding: 1px 4px; border-radius: 3px; }}
</style></head><body>
<h1>AKS Maintenance Operator &mdash; live view</h1>
<p>Auto-refreshes every 5s. Persistent store: <code>{db}</code></p>
<div class='cards'>
  <div class='card'><b>{n_events}</b>events tracked</div>
  <div class='card'><b>{n_upcoming}</b>upcoming actions</div>
  <div class='card'><b>{n_history}</b>history rows</div>
  <div class='card'><b>{dedup}</b>duplicates suppressed</div>
</div>
<h2>Subscriptions polled (#1)</h2>
<ul>{subs}</ul>
<h2>Upcoming maintenance actions (#8)</h2>
<table><tr><th>event</th><th>type</th><th>node</th><th>notBefore</th><th>state</th></tr>
{upcoming}</table>
<h2>All normalized events (#3 / #4)</h2>
<table><tr><th>event</th><th>env</th><th>node</th><th>type</th><th>avail</th>
<th>state</th><th>seen</th><th>dupes</th></tr>
{events}</table>
<h2>Action history (audit trail)</h2>
<table><tr><th>ts</th><th>event</th><th>node</th><th>state</th><th>detail</th></tr>
{history}</table>
</body></html>""".format(
        db=DB_PATH,
        n_events=len(events),
        n_upcoming=len(upcoming),
        n_history=len(history),
        dedup=total_dedup,
        subs=sub_lines,
        upcoming=rows(
            upcoming, ["event_id", "event_type", "target_node", "not_before", "last_state"]
        ),
        events=rows(
            events,
            [
                "event_id",
                "environment",
                "target_node",
                "event_type",
                "availability",
                "last_state",
                "last_seen",
                "dedup_count",
            ],
        ),
        history=rows(history, ["ts", "event_id", "node", "state", "detail"]),
    )


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):  # noqa: D401 - silence default access logs
        return

    def _send(self, code, body, content_type="application/json"):
        payload = body.encode() if isinstance(body, str) else body
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        if self.path in ("/", "/dashboard"):
            self._send(200, render_dashboard(), "text/html; charset=utf-8")
        elif self.path.startswith("/api/events"):
            self._send(200, json.dumps(query_events(), indent=2))
        elif self.path.startswith("/api/upcoming"):
            self._send(200, json.dumps(query_upcoming(), indent=2))
        elif self.path.startswith("/api/history"):
            self._send(200, json.dumps(query_history(200), indent=2))
        elif self.path.startswith("/healthz"):
            self._send(200, json.dumps({"status": "ok"}))
        else:
            self._send(404, json.dumps({"error": "not found"}))

    def do_POST(self):
        if not self.path.startswith("/events"):
            self._send(404, json.dumps({"error": "not found"}))
            return
        length = int(self.headers.get("Content-Length", "0"))
        try:
            message = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            self._send(400, json.dumps({"error": "invalid json"}))
            return
        record_history(message)
        self._send(200, json.dumps({"status": "recorded"}))


def serve():
    server = ThreadingHTTPServer(("0.0.0.0", HTTP_PORT), Handler)
    logging.info("Dashboard/API listening on :%s", HTTP_PORT)
    server.serve_forever()


def main():
    init_db()
    threading.Thread(target=poller_loop, daemon=True).start()
    serve()


if __name__ == "__main__":
    main()
