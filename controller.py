import json
import logging
import os
import time
from datetime import datetime, timedelta, timezone

import requests
from kubernetes import client, config
from kubernetes.client.rest import ApiException


logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s %(message)s",
)

NAMESPACE = os.getenv("POD_NAMESPACE", "aks-maintenance-demo")
NODE_NAME = os.environ["NODE_NAME"]
POLL_SECONDS = int(os.getenv("POLL_SECONDS", "2"))
LIVE_ACTION_MODE = os.getenv("LIVE_ACTION_MODE", "observe").lower()
DEMO_CONFIGMAP = os.getenv("DEMO_CONFIGMAP", "maintenance-demo-events")
WEBHOOK_URL = os.getenv("NOTIFICATION_WEBHOOK_URL", "")
EVENT_STORE_URL = os.getenv("EVENT_STORE_URL", "")
DEFAULT_LEAD_SECONDS = int(os.getenv("LEAD_SECONDS", "1800"))
IMDS_BASE = "http://169.254.169.254/metadata"
IMDS_HEADERS = {"Metadata": "true"}
ACTIONABLE_EVENTS = {
    "Reboot",
    "Redeploy",
    "Preempt",
    "Terminate",
    "HardwareDegraded",
    "HardwareFailure",
}
TERMINAL_STATES = {
    "Cordoned",
    "Drained",
    "SimulatedComplete",
    "Acknowledged",
    "Observed",
    "DrainBlocked",
}

config.load_incluster_config()
core = client.CoreV1Api()


def imds_get(path, api_version="2020-07-01"):
    response = requests.get(
        f"{IMDS_BASE}/{path}",
        headers=IMDS_HEADERS,
        params={"api-version": api_version},
        timeout=2,
    )
    response.raise_for_status()
    return response.json()


def get_local_vm_name():
    try:
        return imds_get("instance/compute", "2021-02-01").get("name")
    except requests.RequestException as exc:
        logging.warning("Unable to read local VM identity from IMDS: %s", exc)
        return None


def get_demo_event():
    try:
        configmap = core.read_namespaced_config_map(DEMO_CONFIGMAP, NAMESPACE)
        raw_event = (configmap.data or {}).get("event.json", "").strip()
        return json.loads(raw_event) if raw_event else None
    except (ApiException, json.JSONDecodeError) as exc:
        logging.error("Unable to read demo event: %s", exc)
        return None


def get_live_events(local_vm_name):
    if not local_vm_name:
        return []

    try:
        document = imds_get("scheduledevents")
    except requests.RequestException as exc:
        logging.warning("Unable to poll Scheduled Events: %s", exc)
        return []

    events = []
    for event in document.get("Events", []):
        if local_vm_name not in event.get("Resources", []):
            continue
        events.append(
            {
                "eventId": event["EventId"],
                "eventType": event["EventType"],
                "eventStatus": event["EventStatus"],
                "source": "AzureIMDS",
                "description": event.get("Description", ""),
                "notBefore": event.get("NotBefore", ""),
            }
        )
    return events


def node_annotations():
    node = core.read_node(NODE_NAME)
    return node.metadata.annotations or {}


def annotate_node(event, state):
    annotations = {
        "maintenance.demo/event-id": event["eventId"],
        "maintenance.demo/event-type": event["eventType"],
        "maintenance.demo/event-source": event["source"],
        "maintenance.demo/state": state,
        "maintenance.demo/updated-at": datetime.now(timezone.utc).isoformat(),
    }
    core.patch_node(NODE_NAME, {"metadata": {"annotations": annotations}})


def notify(event, state, detail=""):
    message = {
        "node": NODE_NAME,
        "eventId": event["eventId"],
        "eventType": event["eventType"],
        "source": event["source"],
        "state": state,
        "detail": detail,
    }
    logging.info("MAINTENANCE_EVENT %s", json.dumps(message, sort_keys=True))
    if WEBHOOK_URL:
        try:
            requests.post(WEBHOOK_URL, json=message, timeout=5).raise_for_status()
        except requests.RequestException as exc:
            logging.error("Notification webhook failed: %s", exc)
    if EVENT_STORE_URL:
        try:
            requests.post(EVENT_STORE_URL, json=message, timeout=5).raise_for_status()
        except requests.RequestException as exc:
            logging.warning("Event store POST failed: %s", exc)


def cordon_lead_status(event):
    """Return (seconds_until_cordon, lead_seconds, cordon_at_iso).

    Honors ``notBefore`` on the event and cordons ``leadSeconds`` before the
    maintenance window (a per-event override of the LEAD_SECONDS default). A
    non-positive first element means the lead window has arrived (act now).
    """
    not_before = event.get("notBefore")
    lead = int(event.get("leadSeconds", DEFAULT_LEAD_SECONDS))
    if not not_before:
        return 0.0, lead, ""
    try:
        not_before_dt = datetime.fromisoformat(not_before.replace("Z", "+00:00"))
    except ValueError:
        return 0.0, lead, ""
    if not_before_dt.tzinfo is None:
        not_before_dt = not_before_dt.replace(tzinfo=timezone.utc)
    cordon_at = not_before_dt - timedelta(seconds=lead)
    seconds = (cordon_at - datetime.now(timezone.utc)).total_seconds()
    return seconds, lead, cordon_at.isoformat()


def cordon_node(event):
    core.patch_node(NODE_NAME, {"spec": {"unschedulable": True}})
    annotate_node(event, "Cordoned")
    notify(event, "Cordoned")


def is_daemonset_pod(pod):
    return any(
        owner.kind == "DaemonSet"
        for owner in (pod.metadata.owner_references or [])
    )


def demo_pods_on_node():
    pods = core.list_namespaced_pod(
        NAMESPACE,
        field_selector=f"spec.nodeName={NODE_NAME}",
    ).items
    return [
        pod
        for pod in pods
        if not is_daemonset_pod(pod)
        and pod.status.phase not in {"Succeeded", "Failed"}
        and pod.metadata.name != os.getenv("HOSTNAME")
    ]


def drain_demo_workload(event, timeout_seconds=360):
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        pods = demo_pods_on_node()
        if not pods:
            annotate_node(event, "Drained")
            notify(event, "Drained")
            return True

        for pod in pods:
            eviction = client.V1Eviction(
                metadata=client.V1ObjectMeta(
                    name=pod.metadata.name,
                    namespace=pod.metadata.namespace,
                )
            )
            try:
                core.create_namespaced_pod_eviction(
                    name=pod.metadata.name,
                    namespace=pod.metadata.namespace,
                    body=eviction,
                )
                logging.info("Eviction requested for %s/%s", pod.metadata.namespace, pod.metadata.name)
            except ApiException as exc:
                if exc.status != 404:
                    logging.warning(
                        "Eviction blocked for %s/%s: %s",
                        pod.metadata.namespace,
                        pod.metadata.name,
                        exc.reason,
                    )
        time.sleep(3)

    annotate_node(event, "DrainBlocked")
    notify(event, "DrainBlocked", "Timed out while honoring disruption controls")
    return False


def acknowledge_live_event(event_id):
    response = requests.post(
        f"{IMDS_BASE}/scheduledevents",
        headers=IMDS_HEADERS,
        params={"api-version": "2020-07-01"},
        json={"StartRequests": [{"EventId": event_id}]},
        timeout=2,
    )
    response.raise_for_status()


def handle_event(event):
    if event.get("eventStatus") != "Scheduled":
        return
    if event.get("eventType") not in ACTIONABLE_EVENTS:
        notify(event, "Observed", "Event type is configured as non-actionable")
        return

    annotations = node_annotations()
    same_event = annotations.get("maintenance.demo/event-id") == event["eventId"]
    current_state = annotations.get("maintenance.demo/state")

    if same_event and current_state in TERMINAL_STATES:
        return

    if event["source"] == "AzureIMDS" and LIVE_ACTION_MODE != "act":
        if not (same_event and current_state == "Observed"):
            annotate_node(event, "Observed")
            notify(event, "Observed", "LIVE_ACTION_MODE is observe")
        return

    # Lead-time scheduling: wait until leadSeconds before the maintenance window.
    seconds_until, lead, cordon_at = cordon_lead_status(event)
    if seconds_until > 0:
        if not (same_event and current_state == "Scheduled"):
            annotate_node(event, "Scheduled")
            notify(
                event,
                "Scheduled",
                f"Cordon scheduled for {cordon_at} "
                f"(T-{lead}s before maintenance; ~{int(seconds_until)}s from now)",
            )
        return

    if not (same_event and current_state == "Detected"):
        annotate_node(event, "Detected")
        notify(event, "Detected", event.get("description", ""))
    cordon_node(event)
    if not drain_demo_workload(event):
        return

    if event["source"] == "AzureIMDS":
        acknowledge_live_event(event["eventId"])
        annotate_node(event, "Acknowledged")
        notify(event, "Acknowledged")
    else:
        annotate_node(event, "SimulatedComplete")
        notify(event, "SimulatedComplete")


def main():
    local_vm_name = get_local_vm_name()
    logging.info(
        "Controller started node=%s vm=%s liveActionMode=%s",
        NODE_NAME,
        local_vm_name,
        LIVE_ACTION_MODE,
    )

    while True:
        demo_event = get_demo_event()
        if demo_event and demo_event.get("targetNode") == NODE_NAME:
            handle_event(demo_event)

        for live_event in get_live_events(local_vm_name):
            handle_event(live_event)

        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()
