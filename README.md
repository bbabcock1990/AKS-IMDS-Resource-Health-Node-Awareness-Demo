# AKS IMDS + Resource Health Node-Awareness Demo

This demo shows how an AKS workload can consume **Azure VM Scheduled Events**
(via IMDS) and **Azure Resource Health**, and translate an actionable
maintenance signal into graceful Kubernetes node protection — cordon, drain,
notify, and recover — *before* the platform disrupts running pods.

> **Placeholders:** the scripts and manifests ship with placeholder values —
> subscription `00000000-0000-0000-0000-000000000000` and `you@example.com`.
> Replace them with your own (or pass `-SubscriptionId` / `-RecipientEmail` to
> the deploy scripts) before running.

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
- Polls a **prod/dev subscription list** for Resource Health signals.
- Keeps a **persistent normalized store + action-history audit trail** (SQLite
  on a PVC) and **de-duplicates** repeat signals.
- Turns a **hardware "Degraded/Unavailable"** signal into a Teams notification
  and drives the controller to cordon/drain the affected node.
- Serves a **live dashboard + JSON API** (`/`, `/api/events`, `/api/upcoming`).

## Safety defaults

- Live Azure events are **observe-only** by default.
- Only the `aks-maintenance-demo` namespace is drained.
- The demo does not modify the AKS-managed VM Scale Set.
- No live event is acknowledged unless `LIVE_ACTION_MODE` is deliberately
  changed to `act`.

These defaults allow the scenario to be demonstrated without forcing real
Azure maintenance or disrupting system workloads.

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

## Prerequisites

- Azure CLI (`az`) logged in to a subscription you can create an AKS cluster in
- `kubectl` (the deploy script fetches credentials via `az aks get-credentials`)
- PowerShell 7+ (scripts are `.ps1`)
- An account with Teams for the optional notification pipeline

## Deploy

```powershell
git clone https://github.com/bbabcock1990/AKS-IMDS-Resource-Health-Node-Awareness-Demo.git
cd AKS-IMDS-Resource-Health-Node-Awareness-Demo
.\deploy.ps1 -SubscriptionId "<your-subscription-id>"
```

One-time subscription prerequisite (needed for the Step 2 Resource Health call):

```powershell
az provider register --namespace Microsoft.ResourceHealth
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
# Hardware-failure ("Degraded") via the operator: subscription poll -> detect ->
# Teams notify -> cordon/drain -> persistent store -> dedup. See RUNBOOK Step 8c.
.\demo-hardware.ps1

# Lead-time scheduling: controller holds in 'Scheduled' then acts leadSeconds
# before the maintenance window. See RUNBOOK Step 8d.
.\demo-leadtime.ps1 -WindowSeconds 120 -LeadSeconds 60

# Live operator dashboard + API (upcoming actions, events, dedup, audit trail):
kubectl port-forward -n aks-maintenance-demo svc/maintenance-operator 8080:8080
# then open http://localhost:8080/
```

## Suggested customer talk track

1. **Resource Health is not the action trigger.** A VMSS can report a transient
   `Degraded` state during normal scale operations.
2. **Scheduled Events is the machine-actionable signal.** The controller polls
   IMDS from every AKS node and filters events to the affected VM.
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
