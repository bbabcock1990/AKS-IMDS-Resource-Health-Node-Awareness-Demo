# AKS Maintenance Demo

This demo shows how an AKS workload can consume Azure VM Scheduled Events and
translate an actionable event into Kubernetes node protection.

## What the demo proves

Two components split the work:

**`maintenance-controller`** (DaemonSet, one pod per node):
- AKS nodes can read the Azure IMDS Scheduled Events endpoint.
- VMSS events must be filtered to the affected VM using the `Resources` field.
- The controller distinguishes Azure signals from a safe simulated signal.
- A node is cordoned before workload eviction.
- Evictions use the Kubernetes Eviction API and honor Pod Disruption Budgets.
- Workloads move to the remaining schedulable node.
- Event identifiers and controller state are stored as node annotations.
- Cordon is scheduled at a **configurable lead time** before the window
  (`leadSeconds` / `LEAD_SECONDS`).
- Structured logs provide an audit trail and can be forwarded to a webhook.

**`maintenance-operator`** (Deployment + PersistentVolume, the control plane):
- Receives a **state-transition report from every controller** (each node POSTs
  to the operator's `/events` endpoint) — the fleet-wide aggregation point.
- Keeps a **persistent normalized store + action-history audit trail** (SQLite
  on a PVC) and **de-duplicates** repeated reports of the same event.
- Serves a **live dashboard + JSON API** (`/`, `/api/events`, `/api/upcoming`,
  `/api/history`) listing tracked and upcoming maintenance actions.

> **Resource Health is intentionally not a signal source.** Resource Health
> "Degraded" is reactive and fires on routine VMSS scale-in, so it is unsafe to
> automate off. The only automation trigger is IMDS Scheduled Events (a typed,
> push-ahead notice that never fires for autoscaler scale operations).

## Safety defaults

- Live Azure events are **observe-only** by default.
- Only the `aks-maintenance-demo` namespace is drained.
- The demo does not modify the AKS-managed VM Scale Set.
- No live event is acknowledged unless `LIVE_ACTION_MODE` is deliberately
  changed to `act`.

These defaults allow the scenario to be demonstrated without forcing real
Azure maintenance or disrupting system workloads.

Only actionable Scheduled Event types drive a cordon. The controller acts on
`Redeploy` and `Reboot` and ignores everything else — so routine platform noise
and autoscaler activity never trigger node protection.

The controller installs its Python dependencies when the demo pod starts to
avoid requiring a container registry. A production implementation should use
an immutable, scanned image, durable external event storage, narrowly scoped
RBAC, alert retry/dead-letter handling, and a tested full-node drain policy.

## Azure resources

- Resource group: `aks-maintenance-demo-rg`
- AKS cluster: `aks-maintenance-demo`
- Region: `westus2`
- Tier: Free control plane
- Nodes: 2 x `Standard_D2als_v7`

The subscription does not permit the lower-cost B-series SKUs. Delete the
resource group after the demonstration to stop compute charges.

## Deploy

```powershell
Set-Location "$env:USERPROFILE\OneDrive - Microsoft\Desktop\AKS-Maintance-Demo"
.\deploy.ps1
```

## Run the demonstration

> For a full presenter walkthrough with per-step explanations, simulation-vs-real
> mapping, and concern-by-concern answers, see **`DEMO-RUNBOOK.md`**.

```powershell
.\demo.ps1
```

The script:

1. Shows the initial node and pod placement.
2. Injects a simulated `Redeploy` Scheduled Event.
3. Waits for the affected node to be cordoned.
4. Shows the demo pods moving to the other node.
5. Displays the controller audit log.
6. Clears the event and safely uncordons the node.

Use `.\status.ps1` to inspect the environment at any time.

## Advanced scenarios (closing the full in-scope list)

```powershell
# IMDS Reboot (or Redeploy) end to end, with the operator store: detect ->
# cordon/drain -> persistent store -> dedup. See RUNBOOK Step 8c.
.\demo-reboot.ps1                 # or: .\demo-reboot.ps1 -EventType Redeploy

# Lead-time scheduling: controller holds in 'Scheduled' then acts leadSeconds
# before the maintenance window. See RUNBOOK Step 8d.
.\demo-leadtime.ps1 -WindowSeconds 120 -LeadSeconds 60

# Live operator dashboard + API (upcoming actions, events, dedup, audit trail):
kubectl port-forward -n aks-maintenance-demo svc/maintenance-operator 8080:8080
# then open http://localhost:8080/
```

## Suggested customer talk track

1. **Resource Health is not the action trigger.** A VMSS can report a transient
   `Degraded` state during normal scale operations, so automating off it would
   cordon healthy nodes. This demo deliberately excludes it.
2. **Scheduled Events is the machine-actionable signal.** The controller polls
   IMDS from every AKS node and acts only on actionable types (`Redeploy`,
   `Reboot`), filtered to the affected VM.
3. **AKS awareness is customer/controller logic.** Azure provides the VM event;
   the controller maps it to a Kubernetes node and performs cordon and eviction.
4. **Notice is bounded.** Reboot/freeze commonly provide 15 minutes and redeploy
   commonly provides 10 minutes. Sudden hardware failure might provide no notice.
5. **Drain safety matters.** PDBs are honored, failed drains are surfaced, and a
   live event must not be acknowledged before preparation succeeds.
6. **Networking remains a separate investigation.** Persistent pod networking
   problems after rescheduling are not assumed to be normal and require CNI,
   EndpointSlice, load-balancer, conntrack, and pod lifecycle evidence.

## Optional notifications (Teams / ServiceNow / Google Chat)

The controller POSTs a structured event to `NOTIFICATION_WEBHOOK_URL` at every
state transition. A ready-made **Teams** pipeline (Azure Logic App → Adaptive
Card) is included and stands in for ServiceNow / Google Chat.

**How an IMDS event becomes a Teams card (end-to-end):**

1. Azure schedules host maintenance and publishes a typed `Reboot`/`Redeploy`
   notice to the VM's **IMDS Scheduled Events** endpoint.
2. The per-node `maintenance-controller` polls node-local IMDS every
   `POLL_SECONDS` (default 2s) and filters events to its own VM via `Resources`.
3. `handle_event()` gates the event: it must be `Scheduled` **and** an actionable
   type (`Reboot`/`Redeploy`). Anything else is `Observed`-only, so autoscaler
   scale-in — which never appears in Scheduled Events — cannot raise a card.
4. On each lifecycle transition (`Detected → Cordoned → Drained →
   Acknowledged`/`SimulatedComplete`), `notify()` builds a JSON payload and
   `POST`s it to both `NOTIFICATION_WEBHOOK_URL` (Teams) and `EVENT_STORE_URL`
   (operator store).
5. The Logic App HTTP trigger receives the payload, composes an **Adaptive Card**
   (State / Event Type / Node / Source / Event ID / Detail), and — if a Teams
   `Workflows` webhook URL is configured — POSTs the card to the channel.

```
Azure host → IMDS Scheduled Events → controller poll (2s) → filter Reboot/Redeploy
   → handle_event → notify() → Logic App → Adaptive Card → Teams Workflows webhook
```

> A Teams card fires **once per state transition**, and only for IMDS
> `Reboot`/`Redeploy` events. Two independent toggles gate delivery:
> `NOTIFICATION_WEBHOOK_URL` (controller → Logic App) and the Logic App's
> `teamsWebhookUrl` (Logic App → channel). Either can stay blank for a dry run.

**This is wired automatically** — `deploy.ps1` calls `deploy-notifications.ps1`,
so once the environment is up, `demo.ps1` fires notifications on its own with no
extra step.

```powershell
# Deliver real cards to a Teams channel: create a Teams 'Workflows' webhook,
# then supply its URL at deploy time (or re-wire later without rebuilding):
.\deploy.ps1 -TeamsWebhookUrl "<workflows-url>"
# or, cluster already up:
.\deploy-notifications.ps1 -TeamsWebhookUrl "<workflows-url>"

# Validate the pipeline out-of-band (no drain needed):
.\test-notification.ps1 -State Cordoned
```

To target ServiceNow or Google Chat instead, swap the final action in
`notifications\teams-logicapp.json` (or the Logic App designer). See
`DEMO-RUNBOOK.md` **Step 8b** for the full walkthrough.

## Cleanup

```powershell
.\cleanup.ps1
```

The cleanup script deletes the Azure resource group but retains this folder.
