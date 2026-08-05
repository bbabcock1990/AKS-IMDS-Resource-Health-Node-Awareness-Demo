# AKS Maintenance Demo — Presenter Runbook (Deep Dive)

A step-by-step script for demonstrating **proactive AKS maintenance handling** to
a customer, with a full explanation of what each command does,
how the mechanism works, how the simulation maps to the real world, and which of
the customer's concerns each step answers.

---

## The core idea (say this up front)

> "Azure treats an AKS node as a VM in a Scale Set. When Azure needs to do
> maintenance — reboot, redeploy, or because it predicts a hardware failure — it
> publishes a **Scheduled Event** to each affected VM *before* it acts. The
> problem today is nobody is *listening* to that signal and turning it into a
> Kubernetes action. This demo shows a small controller that listens, and when
> an event arrives it **cordons** the node (stops new pods landing) and
> **drains** it gracefully (moves running pods off, respecting availability
> rules) *before* Azure touches the hardware. That converts a disruptive,
> pull-the-rug event into an orderly, planned migration."

The whole demo is the loop: **Detect → Cordon → Drain → (Acknowledge) → Recover.**

### Two components (know which does what)
- **`maintenance-controller`** — a **DaemonSet** (one pod per node). Listens to the
  per-VM signal (Azure **Scheduled Events** via IMDS, or an injected demo event)
  and runs the safe **cordon → drain** on its own node. Steps 1–8, 8d.
- **`maintenance-operator`** — a single **Deployment** with a **PersistentVolume**.
  The control-plane piece: **receives a state-transition report from every
  controller** and keeps a **persistent normalized store + audit trail**,
  **de-duplicates**, and serves a **dashboard/API**. It polls nothing and makes
  zero Kubernetes calls. Step 8c.

Together they cover the full in-scope list: detect (IMDS) → map → persist → dedup
→ schedule → cordon/drain → notify → visualize.

---

## Environment

- Subscription: `00000000-0000-0000-0000-000000000000`
- Resource group: `aks-maintenance-demo-rg`
- Cluster: `aks-maintenance-demo` (West US 2, 2 × `Standard_D2als_v7`, K8s 1.35)
- Node resource group (the VMSS lives here): `MC_aks-maintenance-demo-rg_aks-maintenance-demo_westus2`
- Notification path: Logic App `aks-maint-teams-notify` + Teams connection
  `aks-maint-teams` (DM to `you@example.com`).

**Every new PowerShell window needs kubectl on PATH:**
```powershell
cd "$env:USERPROFILE\OneDrive - Microsoft\Desktop\AKS-Maintance-Demo"
$env:PATH = "$env:USERPROFILE\.azure-kubectl;$env:USERPROFILE\.azure-kubelogin;$env:PATH"
```

**Optional prerequisite for Step 2's background call** (only needed if you run the
Resource Health read shown in Step 2 — the mechanism itself no longer uses it):
```powershell
az provider register --namespace Microsoft.ResourceHealth
```
Without this, Step 2's Resource Health call returns
`AuthError ... resource provider has been registered with this subscription`.

---

## Step 0 — Connect

**Run:**
```powershell
az account set --subscription 00000000-0000-0000-0000-000000000000
az aks get-credentials --resource-group aks-maintenance-demo-rg --name aks-maintenance-demo --overwrite-existing
kubectl get nodes
```

**What each command does:**
- `az account set` — points the Azure CLI at the correct subscription.
- `az aks get-credentials` — downloads the cluster's admin kubeconfig and merges
  it into `~/.kube/config`, so `kubectl` now talks to *this* cluster. `--overwrite-existing`
  refreshes stale credentials.
- `kubectl get nodes` — proves connectivity; you should see 2 nodes `Ready`.

**If the cluster was stopped to save money:**
```powershell
az aks start --resource-group aks-maintenance-demo-rg --name aks-maintenance-demo
```

---

## Step 1 — The Azure view: an AKS node IS a VMSS VM

**Run:**
```powershell
# Cluster provisioning + power state
az aks show -g aks-maintenance-demo-rg -n aks-maintenance-demo `
  --query "{name:name, state:provisioningState, power:powerState.code, k8s:currentKubernetesVersion, nodes:agentPoolProfiles[0].count, size:agentPoolProfiles[0].vmSize}" -o table

# The underlying VM Scale Set that backs the AKS node pool
$nodeRg = az aks show -g aks-maintenance-demo-rg -n aks-maintenance-demo --query nodeResourceGroup -o tsv
az vmss list -g $nodeRg --query "[].{name:name, capacity:sku.capacity, size:sku.name}" -o table
```

**What each command does:**
- `az aks show --query {...}` — pulls just the fields we care about (state, power,
  version, node count, VM size) and prints a table. `--query` is a JMESPath filter.
- `$nodeRg = ...` — AKS puts the actual infrastructure (VMSS, disks, NICs, LB) in
  a separate **node resource group** (`MC_*`). This line captures its name.
- `az vmss list -g $nodeRg` — lists the Scale Set(s) backing the node pool.

**How it works / why it matters:** The node you see in `kubectl` and the VM Azure
maintains are the *same object* viewed from two layers. Maintenance events are
emitted at the **VM/VMSS layer**; Kubernetes has no native awareness of them.
That gap is the entire problem we're solving.

**Concern addressed:** Frames *why* AKS gets surprised — the maintenance signal
lives one layer below Kubernetes, and nothing bridges the two by default.

---

## Step 2 — Resource Health: the signal the customer is frustrated with

**Run:**
```powershell
$nodeRg = az aks show -g aks-maintenance-demo-rg -n aks-maintenance-demo --query nodeResourceGroup -o tsv
$vmssId = az vmss list -g $nodeRg --query "[0].id" -o tsv

az rest --method get `
  --url "https://management.azure.com$vmssId/providers/Microsoft.ResourceHealth/availabilityStatuses/current?api-version=2020-05-01" `
  --query "{status:properties.availabilityState, summary:properties.summary, changed:properties.occuredTime}" -o table
```

**What each command does:**
- `$vmssId = ...` — captures the full ARM resource ID of the Scale Set.
- `az rest` — makes a raw authenticated call to the Azure Resource Manager REST
  API. Here it reads the **Resource Health** `availabilityStatuses/current` for
  the Scale Set. `az rest` is used because there's no dedicated `az` command for
  this endpoint. The `--query` trims the response to status/summary/time.
- Expected now: `Available` — "no known Azure platform problems."

**How it works / real world:** Resource Health is a *reactive, human-facing*
signal. Its states are `Available`, `Unavailable`, `Degraded`, `Unknown`.
Critically — and this is the customer's exact complaint — a `Degraded` status can
appear during **normal operations** (e.g., when AKS scales a node pool down, the
VM being deleted briefly reports `Degraded`). So `Degraded` does **not** reliably
mean "hardware is failing."

**Concern addressed (the customer's #1 complaint):** He's right that the docs oversell
`Degraded` as a hardware-failure predictor. This is why you should **not**
automate node draining off Resource Health. Resource Health is great for
dashboards, alerts, and audit — but for *automation* you use **Scheduled Events**
(Steps 5 & 7), which are explicit, typed, and delivered *before* the action.

---

## Step 3 — The workload we're protecting

**Run:**
```powershell
kubectl get nodes -o wide
kubectl get pods -n aks-maintenance-demo -o wide
kubectl get pdb -n aks-maintenance-demo
kubectl get daemonset -n aks-maintenance-demo
```

**What each command does:**
- `kubectl get nodes -o wide` — nodes plus internal IPs, OS image, kernel,
  runtime. `-o wide` adds those extra columns.
- `kubectl get pods -n ... -o wide` — lists the demo app pods **and which node
  each is on** (the `NODE` column). This is what visibly changes during the demo.
- `kubectl get pdb` — shows the **Pod Disruption Budget**: `minAvailable: 2`.
  This is the safety rule that guarantees at least 2 of the 4 app replicas stay
  up during any voluntary disruption (like our drain).
- `kubectl get daemonset` — shows the `maintenance-controller` DaemonSet at
  `2/2` — one controller pod per node.

**How it works:** The demo app is a 4-replica nginx Deployment with a
`topologySpreadConstraint` (`ScheduleAnyway`) so replicas are spread across both
nodes. The DaemonSet pattern guarantees the controller runs on *every* node,
present and future — exactly how you'd run a real node agent.

**Concern addressed:** Establishes the "before" picture and introduces the PDB —
the mechanism that makes draining *safe* rather than an outage.

---

## Step 4 — The controller and its safety model

**Run:**
```powershell
# Show the safety-relevant lines of the controller
kubectl get configmap maintenance-controller-code -n aks-maintenance-demo -o jsonpath='{.data.controller\.py}' | Select-String -Pattern "ACTIONABLE_EVENTS|LIVE_ACTION_MODE|def handle_event|def cordon_node|def drain_demo_workload|create_namespaced_pod_eviction|acknowledge_live_event"

# Show how it's configured (env vars, RBAC, hostNetwork)
kubectl get daemonset maintenance-controller -n aks-maintenance-demo -o jsonpath='{.spec.template.spec.containers[0].env}' ; Write-Host ""
```

**What each command does:**
- The first command pulls the controller source (stored in a ConfigMap) and
  greps for the safety-critical functions/constants.
- The second prints the DaemonSet's environment variables, showing
  `LIVE_ACTION_MODE=observe` and `POLL_SECONDS=2`.

**How the controller works (walk through this):**
Each controller pod runs a 2-second loop (`POLL_SECONDS`). On every tick it:
1. **Identifies itself** — calls IMDS `instance/compute` to learn its own VM name
   (`get_local_vm_name`). This is how it knows which Scheduled Events are "mine."
2. **Reads two event sources:**
   - the **demo ConfigMap** (`maintenance-demo-events`) — how we *simulate*, and
   - the **live Azure IMDS** `scheduledevents` endpoint (`get_live_events`),
     filtering to events whose `Resources` list contains *its own* VM name.
3. **Decides** in `handle_event`:
   - Ignores anything not `EventStatus == Scheduled`.
   - Only acts on `ACTIONABLE_EVENTS = {Reboot, Redeploy, Preempt, Terminate}`.
   - **Dedup:** if the node is already annotated with this `eventId`, it does
     nothing (prevents repeated cordon/drain for the same event).
   - **Safety gate:** if the event came from **AzureIMDS** and
     `LIVE_ACTION_MODE != "act"`, it only annotates `Observed` and logs — it does
     **not** drain. Only simulated (`DemoSimulator`) events, or live events when
     explicitly switched to `act`, trigger action.
4. **Acts** (when allowed): `cordon_node` → `drain_demo_workload` → then, only
   for real Azure events, `acknowledge_live_event` (tells Azure "go ahead, I'm
   ready"). For simulated events it records `SimulatedComplete` instead of
   acknowledging (we never call the real Azure ack in the demo).

**The three safety rules (say these out loud):**
1. **Observe-only by default.** Real Azure events are logged, never acted on,
   until you deliberately set `LIVE_ACTION_MODE=act`. So you can pilot safely in
   production and watch it make the *right* decisions before it's allowed to move
   anything.
2. **Cordon → drain → THEN acknowledge.** The Azure event is only acknowledged
   *after* the workload is safely off the node. We never tell Azure "go ahead"
   while pods are still running. (`acknowledge_live_event` is called last, and
   only on success.)
3. **Respect availability + least privilege.** Draining uses the Kubernetes
   **Eviction API**, which honors the PDB (`minAvailable: 2`). The controller's
   RBAC is scoped to exactly what it needs: get/patch nodes, list pods, create
   `pods/eviction`, read one configmap.

**Concern addressed:** Directly answers "I don't want Azure ripping nodes out
from under AKS" — this front-runs Azure's action and does the graceful thing
first, with built-in safety (observe-mode gating + lead-time) so it can be
trusted in production.

---

## Step 5 — The main event: run the scenario

This injects a **simulated** Redeploy event and shows the controller react live.

**Run:**
```powershell
.\demo.ps1
```

**What `demo.ps1` actually does, in order:**
1. **Picks the target node** — queries the demo pods and chooses the node hosting
   the *most* of them (maximizes the visible movement). Stored in `$targetNode`.
2. **Builds a simulated event** — a JSON object mimicking exactly what Azure IMDS
   delivers:
   ```json
   { "eventId":"demo-<guid>", "targetNode":"<node>", "eventType":"Redeploy",
     "eventStatus":"Scheduled", "source":"DemoSimulator",
     "notBefore":"<now+10min>", "description":"Simulated Azure host redeployment..." }
   ```
   Note `eventType: Redeploy` and `eventStatus: Scheduled` — the same fields, same
   values Azure uses. `source: DemoSimulator` is the only tell that this is
   simulated (it's what lets the controller safely act without touching Azure).
3. **Prints the "before" state** — nodes + pod placement.
4. **Injects the event** — `kubectl patch configmap maintenance-demo-events` writes
   the JSON into the ConfigMap the controllers are polling. Within ~2 seconds the
   controller on the target node sees `targetNode == my node` and calls
   `handle_event`.
5. **Polls the node's state annotation** every 3s, printing the controller's
   progress: you'll see **`Detected → Cordoned → Drained → SimulatedComplete`**.
   These come from `annotate_node(...)` writing `maintenance.demo/state`.
6. **Prints the "after" state** — the target node now shows
   `SchedulingDisabled`, and the app pods have moved to the surviving node.
7. **Shows the controller's audit log** — filtered to `Controller started` and
   `MAINTENANCE_EVENT` JSON lines.
8. **Recovers** — clears the ConfigMap event, `kubectl uncordon`s the node,
   removes the `maintenance.demo/*` annotations, and does a
   `rollout restart` so the app rebalances across both nodes again.

**What maps to the real world vs. what's simulated:**

| Real world (Azure) | This demo |
| --- | --- |
| Azure schedules maintenance and publishes a Scheduled Event to IMDS on the affected VM | We write the *same-shape* event into a ConfigMap the controller polls |
| Controller reads it from `169.254.169.254/metadata/scheduledevents` | Controller reads it from the ConfigMap (and *also* watches the real IMDS in observe mode) |
| Event types `Freeze/Reboot/Redeploy/Preempt/Terminate` with a `NotBefore` lead time | `eventType: Redeploy`, `eventStatus: Scheduled`, `notBefore: now+10m` — identical fields |
| Controller cordons + drains, then POSTs an acknowledgement so Azure proceeds early | Controller cordons + drains the **Kubernetes** node, then records `SimulatedComplete` (no real Azure ack, no VM is touched) |
| Azure then reboots/redeploys the physical host | We simulate completion and return the node to service |

**Why simulate instead of triggering a real redeploy?** Real Scheduled Events
arrive on Azure's timetable (or when you self-trigger a redeploy, which would
actually reboot the VM and take minutes). Simulating gives a **deterministic,
repeatable, seconds-long** demo of the *exact same control logic* — the code path
that runs is identical; only the event *source* differs. Step 7 then proves the
real IMDS endpoint is live and returns the same schema.

**Narrate each state transition to the customer:**
- **Detected** — "The controller saw a Scheduled maintenance event for this node."
- **Cordoned** — "It immediately marked the node unschedulable, so no *new* pods
  land here. This is the piece missing today — nodes stay schedulable right up
  until Azure acts."
- **Drained** — "It gracefully evicted the running pods using the Eviction API,
  which honored our PDB — at least 2 replicas stayed up the entire time. Pods
  rescheduled onto the healthy node."
- **SimulatedComplete** — "Only *after* the workload was safe would we tell Azure
  to proceed. In production this is where we acknowledge the event so Azure does
  the maintenance early, on our terms."

**Concerns addressed:** proactive awareness (Detected), nodes-still-schedulable
problem (Cordoned), disruption/residual impact (Drained + PDB), dedup/audit (the
annotations + JSON log), and "act only when safe" (order of operations).

---

## Step 6 — The evidence: audit trail and dedup

**Run:**
```powershell
.\status.ps1
```
`status.ps1` prints, in one shot: node scheduling state with the
`maintenance.demo/*` annotations as custom columns, pod placement (`-o wide`), and
the controller's filtered audit log.

**Look at the annotations directly (the dedup + audit key):**
```powershell
kubectl get nodes -o custom-columns='NODE:.metadata.name,SCHEDULABLE:.spec.unschedulable,EVENT:.metadata.annotations.maintenance\.demo/event-type,EVENTID:.metadata.annotations.maintenance\.demo/event-id,STATE:.metadata.annotations.maintenance\.demo/state'
```

**Look at the Kubernetes eviction events:**
```powershell
kubectl get events -n aks-maintenance-demo --sort-by=.lastTimestamp | Select-Object -Last 20
```

**How it works / why it matters:**
- Each `maintenance.demo/event-id` annotation on a node is the **dedup key**. If
  the same event is seen again, `handle_event` finds the matching annotation and
  does nothing — no duplicate cordon/drain. This is the customer's "deduplication of
  incoming events."
- Each `MAINTENANCE_EVENT {...}` log line is a structured **audit record**
  (`node`, `eventId`, `eventType`, `source`, `state`, `detail`). It's emitted at
  every state transition — this is your persistent audit trail, and it's already
  shaped as a notification payload.

**Concern addressed:** "Persistent storage of normalized events + action history"
and "deduplication." In production the annotations/logs would be backed by a
database or Log Analytics table; here they're on the node object and in stdout.

---

## Step 7 — Prove the REAL Azure signal is live

**Run:**
```powershell
kubectl run imds-check --rm --restart=Never -i `
  --image=curlimages/curl --overrides='{"spec":{"hostNetwork":true}}' -- `
  curl -s -H "Metadata:true" "http://169.254.169.254/metadata/scheduledevents?api-version=2020-07-01"
```

**What each part does:**
- `kubectl run imds-check --rm --restart=Never -i` — launches a throwaway pod and
  removes it when done. Use `-i` (stream stdin) **not** `-it`: `-t` requests an
  interactive TTY AKS can't upgrade over this channel, producing a harmless
  `couldn't attach ... falling back to streaming logs` warning. `-i` alone is clean.
- `--overrides='{"spec":{"hostNetwork":true}}'` — runs the pod on the **host
  network**. This is required because IMDS (`169.254.169.254`) is a link-local
  address reachable only from the node's own network namespace.
- `curl -H "Metadata:true" .../scheduledevents?api-version=2020-07-01` — the exact
  Azure-documented call. The `Metadata: true` header is mandatory (anti-SSRF).

**Expected output:** `{"DocumentIncarnation":0,"Events":[]}` — an **empty
`Events` array is the healthy baseline** (no maintenance scheduled). This is
success, not an error.

**How it works / real world:** This is the *same* GA endpoint the controller
polls. When Azure schedules a reboot or redeploy, a populated event appears
here first, e.g.:
```json
{ "DocumentIncarnation": 1, "Events": [
  { "EventId":"...", "EventType":"Redeploy", "EventStatus":"Scheduled",
    "Resources":["aks-...-vmss_3"], "NotBefore":"Mon, 04 Aug 2026 ..." } ]}
```
`DocumentIncarnation` increments each time the document changes (a cheap
change-detector). `Resources` lists the specific VM instances affected — the
controller matches this against its own VM name.

**Lead times (useful to quote):** Freeze/Reboot ≈ 15 min notice, Redeploy ≈ 10
min, Terminate 5–15 min (configurable), Spot Preempt ≈ 30 sec. **Predicted**
hardware failure can give days of notice; a **sudden** hardware failure gives
none — which is why detection alone isn't enough and you also need PDBs +
multi-node spread (Step 3) to survive the no-notice case.

**Concern addressed:** Proves this isn't smoke and mirrors — the production signal
is GA, live on every node, and identical in shape to what the demo consumes.

---

## Step 8 — Show live observe-mode wiring (no action taken)

**Run:**
```powershell
kubectl logs -l app=maintenance-controller -n aks-maintenance-demo --since=30m --prefix | Select-String "Controller started"
```

**What it does:** prints each controller pod's startup line, which records the
node, the VM name it resolved from IMDS, and `liveActionMode=observe`.

**How it works:** In `observe` mode the controller *does* poll real Azure events
for its VM, and would **log** one if it appeared — but it will not cordon/drain.
Flipping the DaemonSet env `LIVE_ACTION_MODE=act` is the single switch that
enables automated action on real Azure maintenance.

**Concern addressed:** Gives the customer a safe rollout path — deploy in observe,
watch it make correct decisions against real maintenance, then enable `act`.

---

## Step 8b — Real-time notifications to Teams (simulates ServiceNow / Google Chat)

This is the piece that answers the customer's "notify ServiceNow / Google Chat"
requirement. The controller already emits a structured JSON event at **every**
state transition (`Detected → Cordoned → Drained → SimulatedComplete`). We route
those to an **Azure Logic App** (the integration layer) which formats an
**Adaptive Card** and posts it to a **Teams** channel. Swap the final hop and the
same pipeline delivers to ServiceNow or Google Chat instead — that's the point.

### Architecture (deployed default — built-in Teams connector)
```
controller (notify) --HTTP POST JSON--> Logic App (HTTP trigger)
   --> Compose Adaptive Card --> Teams built-in connector
       (PostCardToConversation) --> DM from 'Flow bot' to you in Teams
```
This is the **enterprise connector pattern** — the exact same shape you'd use to
wire real ServiceNow (create incident) or Google Chat (post message): a managed
**API connection** authorized once with OAuth, then a first-class connector
action. No webhooks, no secrets in the payload.

### One-time deploy (already wired — `deploy.ps1` does this for you)
The notification pipeline is deployed as part of standing up the environment —
`deploy.ps1` calls `deploy-notifications.ps1` automatically. You do **not** run it
during the demo. It only exists as a separate script so you can (re)wire the
destination later without rebuilding the cluster:
```powershell
# Full environment (cluster + controller + notifications) in one shot:
.\deploy.ps1

# Or, if the cluster already exists and you just want to (re)wire notifications:
.\deploy-notifications.ps1 -RecipientEmail "you@example.com"
```
Either path:
- Deploys a **Teams API connection** (`aks-maint-teams`) + a **Consumption Logic
  App** (`aks-maint-teams-notify`) from
  `notifications\teams-logicapp-connector.json` via `az deployment group create`.
  The workflow is: **HTTP request trigger → Compose Adaptive Card →
  PostCardToConversation (Flow bot DM) → respond 200**.
- Reads the trigger's secured **callback URL**
  (`.../triggers/manual/listCallbackUrl`).
- Sets `NOTIFICATION_WEBHOOK_URL` on the controller DaemonSet and restarts it, so
  every controller pod now POSTs its events to the Logic App.

### One-time authorize (the only manual step)
The Teams API connection deploys in an **unauthorized** state. Authorize it once
with your corp account so the Flow bot can DM you:

1. Portal → resource group `aks-maintenance-demo-rg` → API Connection
   **`aks-maint-teams`** → **Edit API connection** → **Authorize** → sign in as
   `you@example.com` → **Save**.
2. Status flips to **Connected**. (Verified working — a test DM landed in Teams.)

> **Why DM to a corp account?** The demo's MCAP tenant has no Teams/O365 license,
> so the connection targets your `@example.com` account cross-tenant. In a real
> deployment the connection would target the customer's own tenant/channel.

### During the demo — notifications are automatic
Once authorized, **you don't run anything extra**. When `demo.ps1` injects a
maintenance event, the controller POSTs one notification per state transition to
the Logic App on its own — you get one **Adaptive Card DM from Flow bot** per
transition (Detected/Cordoned/Drained/SimulatedComplete).

### Test the pipeline without running a full drain
```powershell
.\test-notification.ps1 -State "Detected"
```
This POSTs a sample controller-shaped event to the Logic App; a card DM should
arrive in Teams within a few seconds. Confirm the action fired:
```powershell
$run = az rest --method get --url "https://management.azure.com/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/aks-maintenance-demo-rg/providers/Microsoft.Logic/workflows/aks-maint-teams-notify/runs?api-version=2019-05-01" --query "value[0].name" -o tsv
az rest --method get --url "https://management.azure.com/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/aks-maintenance-demo-rg/providers/Microsoft.Logic/workflows/aks-maint-teams-notify/runs/$run/actions?api-version=2019-05-01" --query "value[].{action:name,status:properties.status}" -o table
```
`Post_card_to_Teams` = **Succeeded** means the DM was delivered.

### Alternative: Teams 'Workflows' webhook (no OAuth, posts to a channel)
If you'd rather post to a **channel** instead of a DM (or can't authorize the
connector), the repo also ships a webhook-mode Logic App:
1. In Teams: target **channel → ••• → Workflows → "Post to a channel when a
   webhook request is received"** → copy the generated URL.
2. Re-deploy in webhook mode:
   ```powershell
   .\deploy-notifications.ps1 -TeamsWebhookUrl "<paste-the-workflows-url>"
   ```
Microsoft is retiring classic O365 "Incoming Webhook" connectors; **Workflows**
(Power Automate) is the supported replacement.

### Show it live during the demo
Run the main scenario and watch cards land in Teams:
```powershell
.\demo.ps1
```
You'll get one Adaptive Card per state transition. To prove it out-of-band or if
you don't want to run a full drain, use `.\test-notification.ps1`.

**See the audit/run history (great screen-share):**
```powershell
az rest --method get `
  --url "https://management.azure.com/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/aks-maintenance-demo-rg/providers/Microsoft.Logic/workflows/aks-maint-teams-notify/runs?api-version=2019-05-01" `
  --query "value[:5].{start:properties.startTime, status:properties.status}" -o table
```
Or in the portal: **Logic App `aks-maint-teams-notify` → Runs history** — each run
shows the incoming event payload and the card that was produced.

**How the simulation maps to the real world:**
- **Real world:** the controller acts on a live Azure Scheduled Event and fires
  the same `notify()` → Logic App → Teams path. Nothing about the notification
  code changes between demo and production.
- **Simulated here:** the *event* is injected via ConfigMap (Step 5), but the
  notification pipeline that carries it to Teams is 100% real Azure infrastructure.

**Concern addressed:** "Optional outbound notifications: ServiceNow incident/work
note; Google Chat space message." The Logic App is the vendor-neutral integration
hub — Teams today, ServiceNow/Google Chat by swapping the final action.

---

## Step 8c — The central operator: store, dedup & dashboard

Steps 1–8 run entirely from the **per-node DaemonSet controller**. That covers
detection + safe cordon/drain beautifully, but several in-scope items are
inherently *control-plane* concerns: keep one central store across the whole
fleet, de-duplicate, and expose a dashboard. Those live in a second component:
the **`maintenance-operator`** Deployment (`maintenance_operator.py`).

### What it is
A single-replica Deployment with a **PersistentVolume** (SQLite store) that is a
**pure aggregation hub — it polls nothing and makes zero Kubernetes API calls**:
1. **Receives a state-transition report from every controller.** Each node's
   controller POSTs to the operator's `/events` endpoint on every transition
   (Detected → Scheduled → Cordoned → Drained → Complete).
2. **Normalizes + persists** every reported event and **de-duplicates** repeats
   (many reports of the same event collapse into one record; `dedup_count`
   climbs).
3. Serves a **live dashboard + JSON API** of upcoming actions, all tracked
   events, dedup counts, and the full action-history audit trail.

> **No Resource Health, no subscription polling.** The only trigger anywhere in
> this system is IMDS Scheduled Events (`Redeploy` / `Reboot`) read by the
> controller. The operator simply records what the controllers report — so
> autoscaler scale-in can never produce a false event here.

### Architecture
```
per-node controller: IMDS Scheduled Events (Redeploy/Reboot)
   detect -> cordon/drain -> SimulatedComplete
   notify(each transition) --POST--> operator /events
                                        operator: normalize -> SQLite (PVC)
                                                  dedup -> dashboard + JSON API
```

### Run the IMDS Reboot/Redeploy scenario end to end
```powershell
.\demo-reboot.ps1                 # or: .\demo-reboot.ps1 -EventType Redeploy
```
Step by step, this:
- Injects a **simulated IMDS Scheduled Event** of type `Reboot` (or `Redeploy`)
  into the node-event ConfigMap with `source=DemoSimulator`.
- The controller **detects** it, **cordons + drains** the affected node, and
  **POSTs each transition** to the operator, which **stores** a normalized event.
- Prints the persisted events from the operator API, then **re-POSTs the same
  report** to prove **deduplication** — `dedup_count` climbs but **no second
  action** fires and **no second row** is created.
- Resets (clears the event, uncordons, rebalances).

> The demo targets the node **not** running the operator, so the operator stays up
> and its store keeps recording through the drain. (In production the operator
> would sit on a separate system nodepool.)

### See the persistent store + dashboard (great screen-share)
```powershell
# API straight from the pod:
$op = kubectl get pods -n aks-maintenance-demo -l app=maintenance-operator -o jsonpath='{.items[0].metadata.name}'
kubectl exec $op -n aks-maintenance-demo -- python -c "import urllib.request;print(urllib.request.urlopen('http://localhost:8080/api/events').read().decode())"

# Or the visual dashboard in a browser:
kubectl port-forward -n aks-maintenance-demo svc/maintenance-operator 8080:8080
# then open http://localhost:8080/  (auto-refreshes every 5s)
```
The dashboard shows: upcoming actions (#8), every tracked event with dedup counts
(#3/#4), and the action-history audit trail. Because the store is on a **PVC**, it
survives pod restarts — reschedule the operator and the history is still there.

**How the simulation maps to the real world:**
- **Real:** the controller reads a genuine IMDS Scheduled Event from node-local
  `169.254.169.254` and flows it through the identical detect → cordon/drain →
  report → store path.
- **Simulated:** only the *event source* is a ConfigMap instead of the IMDS
  endpoint, so we can trigger a Reboot/Redeploy on demand. Everything downstream
  is real.

**Concerns addressed:** VMSS→node mapping (#2), persistent normalized store +
audit (#3), deduplication (#4), and operator dashboard/API visibility (#8).

---

## Step 8d — Lead-time scheduling (cordon *ahead* of the window)

the customer asked for cordon **"at a configurable lead time before maintenance."** The
controller honors the event's `notBefore` and cordons `leadSeconds` **before** the
window — not on first sight.

```powershell
.\demo-leadtime.ps1 -WindowSeconds 120 -LeadSeconds 60
```
You'll watch the controller sit in **`Scheduled`** (and send a "Scheduled" Teams
card noting the planned cordon time) for ~60s, then cordon/drain exactly at the
lead boundary. In production `LEAD_SECONDS` (DaemonSet env, default 1800) or a
per-event `leadSeconds` sets how far ahead to act; the main demo uses a large
default so it acts immediately for a snappy walkthrough.

**Concern addressed:** "Scheduling and executing cordon on affected nodes at a
configurable lead time before maintenance" (#5).

---

## Step 9 — Reset between runs

`demo.ps1` self-resets, but to force a clean slate:

**Run:**
```powershell
kubectl patch configmap maintenance-demo-events -n aks-maintenance-demo --type merge --patch '{"data":{"event.json":""}}'
kubectl get nodes -o name | ForEach-Object { kubectl uncordon $_ }
kubectl rollout restart deployment/maintenance-demo-app -n aks-maintenance-demo
kubectl rollout status deployment/maintenance-demo-app -n aks-maintenance-demo
```

**What each does:** clears the simulated event; uncordons every node; restarts
the app so replicas rebalance; waits for the rollout to finish. You can now re-run
`.\demo.ps1` cleanly as many times as you like.

---

## Step 10 — Cost control (after the demo)

**Stop the cluster (keep it, minimal cost):**
```powershell
az aks stop --resource-group aks-maintenance-demo-rg --name aks-maintenance-demo
```
`az aks stop` deallocates the nodes so you stop paying for compute but keep the
cluster config for next time. `az aks start` brings it back.

**Delete everything (removes all charges):**
```powershell
.\cleanup.ps1
```
`cleanup.ps1` deletes the resource group, which tears down the cluster, the
`MC_*` node resource group, the VMSS, disks, and load balancer.

---

## Quick command cheat-sheet

| Purpose | Command |
| --- | --- |
| Connect | `az aks get-credentials -g aks-maintenance-demo-rg -n aks-maintenance-demo --overwrite-existing` |
| Cluster status | `az aks show -g aks-maintenance-demo-rg -n aks-maintenance-demo -o table` |
| Node status | `kubectl get nodes -o wide` |
| Pod placement | `kubectl get pods -n aks-maintenance-demo -o wide` |
| Run scenario | `.\demo.ps1` |
| Run IMDS Reboot/Redeploy scenario | `.\demo-reboot.ps1` (or `-EventType Redeploy`) |
| Run lead-time scenario | `.\demo-leadtime.ps1 -WindowSeconds 120 -LeadSeconds 60` |
| Operator dashboard | `kubectl port-forward -n aks-maintenance-demo svc/maintenance-operator 8080:8080` → http://localhost:8080/ |
| Operator events API | `kubectl exec <operator-pod> -n aks-maintenance-demo -- python -c "import urllib.request;print(urllib.request.urlopen('http://localhost:8080/api/events').read().decode())"` |
| Inspect result | `.\status.ps1` |
| Deploy Teams notifications | `.\deploy-notifications.ps1 [-TeamsWebhookUrl '<url>']` |
| Test a notification | `.\test-notification.ps1 -State Cordoned` |
| Live IMDS check | see Step 7 |
| Reset | see Step 9 |
| Stop cluster | `az aks stop -g aks-maintenance-demo-rg -n aks-maintenance-demo` |
| Delete all | `.\cleanup.ps1` |

---

## Mapping the demo to the customer's concerns

| the customer's concern | Where the demo answers it |
| --- | --- |
| "Degraded" is inaccurate / fires on scale-down | Step 2 — Resource Health shown and explained as non-actionable |
| No proactive maintenance awareness | Steps 5 & 7 — Scheduled Events detected before impact |
| Nodes still schedulable when maintenance starts | Step 5 — node cordoned before drain |
| Azure redeploys the node out from under AKS | Step 5 — controller front-runs Azure: drains first, acknowledges last |
| Residual pod/network impact after redeploy | Step 5 — graceful eviction + PDB + recovery; networking flagged as a separate, parallel investigation |
| No dedup / audit / history | Steps 6 & 8c — eventId dedup + JSON audit log + operator's persistent SQLite store & audit trail |
| Wants ServiceNow / Google Chat notifications | Step 8b — controller → Logic App → Teams Adaptive Card (swap final hop for ServiceNow/Google Chat) |
| Notification of **maintenance actions** (Reboot/Redeploy) | Step 8b/8c — controller notifies on every transition; operator records + surfaces them |
| Cordon at a configurable **lead time** before maintenance | Step 8d — controller holds in `Scheduled` and acts `leadSeconds` before `notBefore` |
| Operator visibility / dashboard of upcoming actions | Step 8c — live dashboard + `/api/events`, `/api/upcoming` |
| Poor Azure support / needs an SME + existing patterns | Whole demo — proven Scheduled Events pattern + working reference implementation |

---

## Production hardening (if asked "is this production-ready?")

This is a **reference demo**, deliberately small — but it now covers the whole
in-scope list (detect → map → persist → dedup → schedule → cordon/drain → notify →
dashboard). For production you'd:
- Package the controller **and operator** as versioned images in ACR (no
  `pip install` at pod start).
- Move the operator's SQLite store to a managed backing (Azure SQL / Cosmos /
  Log Analytics) and run the operator on a dedicated **system nodepool**.
- Add the real **ServiceNow + Google Chat** actions behind the same Logic App /
  `notify()` hop already proven with Teams.
- Consider the CNCF **`node-problem-detector`** + a reboot/drain manager, or
  Azure's own node auto-drain features, and compare against this Scheduled-Events
  approach.
- Alert on **sudden** (no-notice) failures via Resource Health + PDB/spread, since
  detection can't help when there's zero lead time. (Resource Health is used for
  awareness/alerting only — never as an automation trigger.)
