"""Central maintenance operator for the AKS maintenance demo.

Acts as the demo's small "control plane": a persistent store, deduplicator,
dashboard and audit hub for the maintenance events the per-node controller
acts on. The controller reads Azure IMDS Scheduled Events on each node, acts on
actionable maintenance (Redeploy / Reboot), and POSTs every state transition to
this operator's ``/events`` endpoint. The operator normalizes and persists those
reports, so the fleet-wide picture lives in one place:

  #3 Persistent normalized store     -> SQLite on a PersistentVolume holding one
                                       normalized record per event plus the full
                                       action history.
  #4 Deduplication                   -> repeated reports of the same event are
                                       collapsed into a single record with a
                                       report counter, not duplicated.
  #8 Operator visibility             -> an HTTP dashboard + JSON API listing
                                       upcoming actions, tracked events and the
                                       audit trail.

Resource Health is intentionally NOT a signal source here. Resource Health
"Degraded" is reactive and noisy -- it fires on routine VMSS scale-in -- so it is
unsafe to automate off. The only automation trigger is IMDS Scheduled Events
(a typed, push-ahead notice that never fires for autoscaler scale operations),
handled by the controller; this operator simply aggregates what the controller
reports.
"""

import json
import logging
import os
import sqlite3
import threading
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s %(message)s",
)

HTTP_PORT = int(os.getenv("HTTP_PORT", "8080"))
DB_PATH = os.getenv("DB_PATH", "/data/maintenance.db")

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
# Event ingest (#3 / #4) -- reports POSTed by the per-node controller
# --------------------------------------------------------------------------- #
def ingest_report(message):
    """Persist one maintenance report from the controller: normalize + store the
    event (deduplicating repeats), then append the transition to the audit trail.
    The controller POSTs one report per state transition (Observed, Scheduled,
    Detected, Cordoned, SimulatedComplete/Acknowledged)."""
    event = {
        "eventId": message.get("eventId"),
        "subscription": "",
        "environment": "",
        "targetNode": message.get("node", ""),
        "eventType": message.get("eventType", ""),
        "source": message.get("source", ""),
        "availability": "",
        "notBefore": message.get("notBefore", ""),
        "description": message.get("description", "") or message.get("detail", ""),
    }
    if not event["eventId"]:
        return False
    is_new = upsert_event(event)
    record_history(message)
    if is_new:
        logging.info(
            "Tracking %s on %s (source=%s, state=%s)",
            event["eventType"] or "event",
            event["targetNode"] or "unmapped",
            event["source"] or "unknown",
            message.get("state", ""),
        )
    return is_new



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
<p>Auto-refreshes every 5s. Aggregates IMDS Scheduled Event actions reported by
the per-node controller. Persistent store: <code>{db}</code></p>
<div class='cards'>
  <div class='card'><b>{n_events}</b>events tracked</div>
  <div class='card'><b>{n_upcoming}</b>upcoming actions</div>
  <div class='card'><b>{n_history}</b>history rows</div>
  <div class='card'><b>{dedup}</b>duplicate reports collapsed</div>
</div>
<h2>Upcoming maintenance actions (#8)</h2>
<table><tr><th>event</th><th>type</th><th>node</th><th>notBefore</th><th>state</th></tr>
{upcoming}</table>
<h2>Tracked maintenance events (#3 / #4)</h2>
<table><tr><th>event</th><th>node</th><th>type</th><th>source</th>
<th>state</th><th>seen</th><th>reports</th></tr>
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
        upcoming=rows(
            upcoming, ["event_id", "event_type", "target_node", "not_before", "last_state"]
        ),
        events=rows(
            events,
            [
                "event_id",
                "target_node",
                "event_type",
                "source",
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
        ingest_report(message)
        self._send(200, json.dumps({"status": "recorded"}))


def serve():
    server = ThreadingHTTPServer(("0.0.0.0", HTTP_PORT), Handler)
    logging.info("Dashboard/API listening on :%s", HTTP_PORT)
    server.serve_forever()


def main():
    init_db()
    logging.info("Operator ready: ingesting controller reports at POST /events")
    serve()


if __name__ == "__main__":
    main()
