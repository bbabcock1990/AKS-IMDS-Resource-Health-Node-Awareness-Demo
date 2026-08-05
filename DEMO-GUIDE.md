# AKS Node Maintenance Awareness — Demo Guide

**Audience:** Platform / SRE team · **Presenter:** AKS SME
**Duration:** ~35–40 min demo + Q&A · **Format:** live Azure + Teams

> This single guide is both the **run-of-show** (what to *say*, in quotes) and the
> **command reference** (what to *run*, what each command does, how it maps to the
> real world, and which requirement it answers). Present it top-to-bottom.

## How to read each step

- 🎤 **SAY** — the talking track (say it in your own words; this is the intent).
- ⌨️ **DO** — the command(s) to run.
- 👀 **POINT AT** — what to draw their eye to on screen.
- 🧠 **HOW IT WORKS** — the underlying Azure / Kubernetes behavior to teach.
- ✅ **ADDRESSES** — which of the requirements this closes.

---

## The core idea (say this up front)

> "Azure treats an AKS node as a VM in a Scale Set. When Azure needs to service
> the host under it — a **reboot** or a **redeploy** — it publishes a **Scheduled
> Event** to that VM *before* it acts. The problem today is nobody on the
> Kubernetes side is *listening*, so Azure can move the node out from under AKS
> while pods are still running on it — the rug-pull, plus the residual
> pod-networking mess afterward. This demo is a small controller that listens, and
> when an event arrives it **cordons** the node (stops new pods landing) and
> **drains** it gracefully (moves running pods off, respecting availability rules)
> *before* Azure touches the hardware. That converts a disruptive, pull-the-rug
> event into an orderly, planned migration."

The whole demo is one loop: **Detect → Cordon → Drain → (Acknowledge) → Recover.**

### Two components (know which does what)

- **`maintenance-controller`** — a **DaemonSet** (one pod per node). Reads its own
  node's Azure **IMDS Scheduled Events** (or an injected demo event) and runs the
  safe **cordon → drain** on that node. It acts **only** on `Reboot` / `Redeploy`.
- **`maintenance-operator`** — a single **Deployment** with a **PersistentVolume**.
  The control-plane piece: every controller **POSTs its state transitions** here;
  it keeps a **persistent normalized store + audit trail**, **de-duplicates**, and
  serves a **dashboard / API**. It polls nothing and makes zero Kubernetes calls.

Together they cover the full in-scope list: detect (IMDS) → map → persist → dedup
→ schedule → cordon/drain → notify → visualize.

---

## Environment

- Subscription: `<your-subscription-id>` (the scripts default to your current `az` context)
- Resource group: `aks-maintenance-demo-rg`
- Cluster: `aks-maintenance-demo` (West US 2, 2 × `Standard_D2als_v7`, K8s 1.35)
- Node resource group (the VMSS lives here): `MC_aks-maintenance-demo-rg_aks-maintenance-demo_westus2`
- Notification path: Logic App `aks-maint-teams-notify` + Teams connection `aks-maint-teams`.

**Every new PowerShell window needs kubectl on PATH:**
```powershell
cd "$env:USERPROFILE\OneDrive - Microsoft\Desktop\AKS-IMDS-Resource-Health-Node-Awareness-Demo"
$env:PATH = "$env:USERPROFILE\.azure-kubectl;$env:USERPROFILE\.azure-kubelogin;$env:PATH"
```

## Pre-flight (5 min before the call — do NOT screen-share yet)

```powershell
az account set --subscription <your-subscription-id>   # or omit to use your current az context
az aks get-credentials -g aks-maintenance-demo-rg -n aks-maintenance-demo --overwrite-existing
kubectl get nodes                                  # both Ready
kubectl get pods -n aks-maintenance-demo -o wide   # controller 2/2, operator 1/1, app 4/4
```
- Confirm the **Teams connection is Connected** (Portal → RG → `aks-maint-teams`).
- Start the **dashboard tunnel** in a *second* terminal and leave it running:
  ```powershell
  kubectl port-forward -n aks-maintenance-demo svc/maintenance-operator 8080:8080
  ```
- Open browser tabs: **http://localhost:8080/**, the Azure Portal on the cluster,
  and **Teams** (so the card DM is visible when it lands).
- Have `.\demo.ps1`, `.\demo-reboot.ps1`, `.\demo-leadtime.ps1` ready to paste.

> If the cluster was stopped to save money:
> `az aks start -g aks-maintenance-demo-rg -n aks-maintenance-demo`.
> If anything looks off, `.\deploy.ps1` rebuilds the whole environment idempotently.

---

## Opening (2 min) — frame the problem in *their* words

🎤 **SAY:**
> "I want to state your problem back to you so you know we're aligned. Azure treats
> every AKS node as a VM in a Scale Set. When Azure services the underlying
> hardware — a **reboot** or a **redeploy** — it does that on the VM. If nothing on
> the Kubernetes side is *listening*, Azure can move that node out from under AKS
> while your pods are still running on it. That's the rug-pull you're seeing, and
> the residual pod-networking mess afterward.
>
> The good news: **Azure announces almost all of this before it happens**, on a
> signal called Scheduled Events. Nobody's job by default is to listen and
> translate it into a Kubernetes action. Today I'll show you a small, safe
> reference implementation that does exactly that — and I'll be explicit about
> what's real Azure behavior versus what I'm simulating so we can trigger it on a
> call."

🧠 **HOW IT WORKS:** AKS node pools are VM Scale Sets; the AKS control plane is
managed, but the *nodes* are VMs subject to platform maintenance.

---

## Step 1 — The Azure reality: an AKS node IS a VMSS VM

🎤 **SAY:**
> "Let's ground this in the platform. These two Kubernetes nodes are literally two
> VMs in a Scale Set that AKS created — the same object Azure schedules
> maintenance on."

⌨️ **DO:**
```powershell
kubectl get nodes -o wide

# Cluster provisioning + power state
az aks show -g aks-maintenance-demo-rg -n aks-maintenance-demo `
  --query "{name:name, state:provisioningState, power:powerState.code, k8s:currentKubernetesVersion, nodes:agentPoolProfiles[0].count, size:agentPoolProfiles[0].vmSize}" -o table

# The underlying VM Scale Set that backs the AKS node pool
$nodeRg = az aks show -g aks-maintenance-demo-rg -n aks-maintenance-demo --query nodeResourceGroup -o tsv
az vmss list -g $nodeRg --query "[].{name:name, capacity:sku.capacity, size:sku.name}" -o table
```

👀 **POINT AT:** the node names line up with the VMSS instances.

🧠 **HOW IT WORKS:** The node you see in `kubectl` and the VM Azure maintains are
the *same object* viewed from two layers. AKS puts the real infrastructure (VMSS,
disks, NICs, LB) in a separate **node resource group** (`MC_*`). Maintenance events
are emitted at the **VM/VMSS layer**; Kubernetes has no native awareness of them.
That gap is the entire problem we're solving.

✅ **ADDRESSES:** why AKS gets "surprised" — the maintenance target is the VM, one
layer below Kubernetes, and nothing bridges the two by default.

---

## Step 2 — The workload we're protecting

🎤 **SAY:**
> "Here's a stand-in for your workload — a small web deployment across both nodes,
> with a **Pod Disruption Budget** that says 'never take me below 2 available.'
> That PDB is the safety contract the drain will respect."

⌨️ **DO:**
```powershell
kubectl get nodes -o wide
kubectl get pods -n aks-maintenance-demo -o wide -l app=maintenance-demo-app
kubectl get pdb -n aks-maintenance-demo
kubectl get daemonset -n aks-maintenance-demo
```

👀 **POINT AT:** pods spread across both nodes; `minAvailable: 2`; the
`maintenance-controller` DaemonSet at `2/2` (one pod per node).

🧠 **HOW IT WORKS:** The demo app is a 4-replica nginx Deployment with a
`topologySpreadConstraint` so replicas spread across both nodes. A
**PodDisruptionBudget** makes *voluntary* evictions (like a drain) honor
availability — the Eviction API blocks if it would breach `minAvailable: 2`. The
DaemonSet pattern guarantees the controller runs on *every* node, present and
future — exactly how you'd run a real node agent.

✅ **ADDRESSES:** establishes the "before" picture and the PDB — the mechanism that
makes draining *safe* rather than an outage.

---

## Step 3 — The controller and its safety model

🎤 **SAY:**
> "The listener is a **DaemonSet** — one pod on every node — called
> `maintenance-controller`. Each pod watches *its own* node's signal. Two safety
> defaults matter to you: first, real Azure events are **observe-only** by
> default — it will *tell* you but not act until you flip one env var to `act`.
> Second, its RBAC is scoped to exactly cordon/drain — it can't touch the Scale Set
> or system workloads."

⌨️ **DO:**
```powershell
# Show the safety-relevant lines of the controller
kubectl get configmap maintenance-controller-code -n aks-maintenance-demo -o jsonpath='{.data.controller\.py}' | Select-String -Pattern "LIVE_ACTION_MODE|def handle_event|def cordon_node|def drain_demo_workload|create_namespaced_pod_eviction|acknowledge_live_event"

# ACTIONABLE_EVENTS is a multi-line set -- print it with its members
kubectl get configmap maintenance-controller-code -n aks-maintenance-demo -o jsonpath='{.data.controller\.py}' | Select-String -Pattern "ACTIONABLE_EVENTS" -Context 0,3

# Show how it's configured (env vars)
kubectl set env daemonset/maintenance-controller -n aks-maintenance-demo --list | Select-String "LIVE_ACTION_MODE|LEAD_SECONDS|WEBHOOK|STORE|POLL_SECONDS"
```

👀 **POINT AT:** `LIVE_ACTION_MODE=observe` (the safety switch) and the
`ACTIONABLE_EVENTS` set, whose members are `"Reboot"` and `"Redeploy"` (the
`-Context 0,3` prints the opening line plus the two members and the closing brace).

🧠 **HOW IT WORKS (walk through this):** Each controller pod runs a 2-second loop
(`POLL_SECONDS`). On every tick it:
1. **Identifies itself** — calls IMDS `instance/compute` to learn its own VM name
   (`get_local_vm_name`). This is how it knows which Scheduled Events are "mine."
2. **Reads two event sources:** the **demo ConfigMap** (`maintenance-demo-events`,
   how we *simulate*) and the **live Azure IMDS** `scheduledevents` endpoint
   (`get_live_events`), filtering to events whose `Resources` list contains its own
   VM name.
3. **Decides** in `handle_event`:
   - Ignores anything not `EventStatus == Scheduled`.
   - Acts **only** on `ACTIONABLE_EVENTS = {Reboot, Redeploy}` — everything else is
     logged and ignored.
   - **Dedup:** if the node is already annotated with this `eventId`, it does
     nothing (prevents repeated cordon/drain for the same event).
   - **Safety gate:** if the event came from **AzureIMDS** and
     `LIVE_ACTION_MODE != "act"`, it only annotates `Observed` and logs — it does
     **not** drain. Only simulated (`DemoSimulator`) events, or live events when
     explicitly switched to `act`, trigger action.
4. **Acts** (when allowed): `cordon_node` → `drain_demo_workload` → then, only for
   real Azure events, `acknowledge_live_event` (tells Azure "go ahead, I'm ready").
   For simulated events it records `SimulatedComplete` instead — no real Azure ack,
   no VM is touched.

**The three safety rules (say these out loud):**
1. **Observe-only by default.** Real Azure events are logged, never acted on, until
   you deliberately set `LIVE_ACTION_MODE=act`. Pilot safely in production and watch
   it make the *right* decisions before it's allowed to move anything.
2. **Cordon → drain → THEN acknowledge.** The Azure event is only acknowledged
   *after* the workload is safely off the node. We never tell Azure "go ahead" while
   pods are still running.
3. **Respect availability + least privilege.** Draining uses the Kubernetes
   **Eviction API**, which honors the PDB (`minAvailable: 2`). The controller's RBAC
   is scoped to exactly what it needs: get/patch nodes, list pods, create
   `pods/eviction`, read one configmap.

✅ **ADDRESSES:** "I don't want Azure ripping nodes out from under AKS" — *we*
front-run Azure, on our terms, with built-in safety (observe-mode gating +
lead-time) so it can be trusted in production.

---

## Step 4 — The main event: run the scenario

This injects a **simulated** Redeploy event and shows the controller react live.

⌨️ **DO:**
```powershell
.\demo.ps1
```

🎤 **SAY:**
> "I'll inject a simulated **Redeploy** Scheduled Event against the busiest node —
> same shape Azure delivers — and we watch the controller react. Keep your eye on
> the node status and where the pods are."

**What `demo.ps1` does, in order:**
1. **Picks the target node** — the node hosting the *most* demo pods (maximizes
   visible movement).
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
   the JSON into the ConfigMap the controllers poll. Within ~2s the controller on
   the target node sees `targetNode == my node` and calls `handle_event`.
5. **Polls the node's state annotation** every 3s, printing the controller's
   progress: **`Detected → Cordoned → Drained → SimulatedComplete`**.
6. **Prints the "after" state** — the target node now shows `SchedulingDisabled`,
   and the app pods have moved to the surviving node.
7. **Shows the controller's audit log** — the `MAINTENANCE_EVENT` JSON lines.
8. **Recovers** — clears the event, `kubectl uncordon`s the node, removes the
   `maintenance.demo/*` annotations, and `rollout restart`s so the app rebalances.

**Narrate each state transition:**
- **Detected** — "The controller saw a Scheduled maintenance event for this node."
- **Cordoned** — "It immediately marked the node unschedulable, so no *new* pods
  land here. This is the piece missing today — nodes stay schedulable right up until
  Azure acts."
- **Drained** — "It gracefully evicted the running pods using the Eviction API,
  which honored our PDB — at least 2 replicas stayed up the entire time. Pods
  rescheduled onto the healthy node."
- **SimulatedComplete** — "Only *after* the workload was safe would we tell Azure to
  proceed. In production this is where we acknowledge the event so Azure does the
  maintenance early, on our terms."

**What maps to the real world vs. what's simulated:**

| Real world (Azure) | This demo |
| --- | --- |
| Azure schedules maintenance and publishes a Scheduled Event to IMDS on the affected VM | We write the *same-shape* event into a ConfigMap the controller polls |
| Controller reads it from `169.254.169.254/metadata/scheduledevents` | Controller reads it from the ConfigMap (and *also* watches the real IMDS in observe mode) |
| Event types `Freeze/Reboot/Redeploy/Preempt/Terminate` with a `NotBefore` lead time | `eventType: Redeploy`, `eventStatus: Scheduled`, `notBefore: now+10m` — identical fields |
| Controller cordons + drains, then POSTs an acknowledgement so Azure proceeds early | Controller cordons + drains the **Kubernetes** node, then records `SimulatedComplete` (no real Azure ack, no VM is touched) |
| Azure then reboots/redeploys the physical host | We simulate completion and return the node to service |

**Why simulate instead of triggering a real redeploy?** Real Scheduled Events
arrive on Azure's timetable (or when you self-trigger a redeploy, which actually
reboots the VM and takes minutes). Simulating gives a **deterministic, repeatable,
seconds-long** demo of the *exact same control logic* — the code path that runs is
identical; only the event *source* differs. Step 6 proves the real IMDS endpoint is
live and returns the same schema.

✅ **ADDRESSES:** proactive awareness (Detected), nodes-still-schedulable problem
(Cordoned), disruption/residual impact (Drained + PDB), and "act only when safe"
(order of operations) — all at once.

---

## Step 5 — The evidence: audit trail and dedup

⌨️ **DO:**
```powershell
.\status.ps1

# Node annotations (the dedup + audit key)
kubectl get nodes -o custom-columns='NODE:.metadata.name,SCHEDULABLE:.spec.unschedulable,EVENT:.metadata.annotations.maintenance\.demo/event-type,EVENTID:.metadata.annotations.maintenance\.demo/event-id,STATE:.metadata.annotations.maintenance\.demo/state'

# Kubernetes eviction events
kubectl get events -n aks-maintenance-demo --sort-by=.lastTimestamp | Select-Object -Last 20
```

🧠 **HOW IT WORKS:**
- Each `maintenance.demo/event-id` annotation on a node is the **dedup key**. If the
  same event is seen again, `handle_event` finds the matching annotation and does
  nothing — no duplicate cordon/drain.
- Each `MAINTENANCE_EVENT {...}` log line is a structured **audit record** (`node`,
  `eventId`, `eventType`, `source`, `state`, `detail`), emitted at every transition —
  already shaped as a notification payload.

✅ **ADDRESSES:** "persistent storage of normalized events + action history" and
"deduplication." (The operator in Step 9 makes this durable and fleet-wide.)

---

## Step 6 — Prove the REAL Azure signal is live

🎤 **SAY:**
> "Fair challenge: 'you injected that event — is the real signal actually there?'
> Let me hit the **real** Azure endpoint from inside a node, live."

⌨️ **DO:**
```powershell
kubectl run imds-check --rm --restart=Never -i `
  --image=curlimages/curl --overrides='{"spec":{"hostNetwork":true}}' -- `
  curl -s -H "Metadata:true" "http://169.254.169.254/metadata/scheduledevents?api-version=2020-07-01"
```

👀 **POINT AT:** `{"DocumentIncarnation":0,"Events":[]}` — the endpoint is real and
reachable; an **empty `Events` array is the healthy baseline** (no maintenance
scheduled). This is success, not an error.

🧠 **HOW IT WORKS:** This is the *same* GA endpoint the controller polls, at the
non-routable `169.254.169.254` — every Azure VM has it, no credentials needed. Use
`-i` (stream stdin) not `-it`: `-t` requests a TTY AKS can't upgrade over this
channel. `--overrides hostNetwork:true` is required because IMDS is link-local (only
reachable from the node's own netns) — the same reason the controller uses
`hostNetwork: true`. The `Metadata: true` header is mandatory (anti-SSRF). When Azure
schedules a reboot/redeploy, a populated event appears here first:
```json
{ "DocumentIncarnation": 1, "Events": [
  { "EventId":"...", "EventType":"Redeploy", "EventStatus":"Scheduled",
    "Resources":["aks-...-vmss_3"], "NotBefore":"Mon, 04 Aug 2026 ..." } ]}
```
`DocumentIncarnation` increments each time the document changes; `Resources` lists
the specific VM instances affected — the controller matches this against its own VM.

**Lead times (useful to quote):** Freeze/Reboot ≈ 15 min notice, Redeploy ≈ 10 min,
Terminate 5–15 min (configurable), Spot Preempt ≈ 30 sec.

🎤 **SAY (important honesty):**
> "One caveat I'll never hide: **sudden, unpredicted hardware death gives zero
> notice** — no signal can help there. For that case the answer is resilience: PDBs,
> spread across nodes/zones, fast reschedule. Everything *predicted or planned*,
> though, we catch ahead of time."

✅ **ADDRESSES:** "is this smoke and mirrors?" — no; the production trigger is GA,
live on every node, and identical in shape to what the demo consumes.

---

## Step 7 — Live observe-mode wiring (no action taken)

⌨️ **DO:**
```powershell
kubectl logs -l app=maintenance-controller -n aks-maintenance-demo --since=30m --prefix | Select-String "Controller started"
```

🧠 **HOW IT WORKS:** each controller pod's startup line records the node, the VM name
it resolved from IMDS, and `liveActionMode=observe`. In `observe` mode the controller
*does* poll real Azure events for its VM and would **log** one if it appeared — but it
will not cordon/drain. Flipping the DaemonSet env `LIVE_ACTION_MODE=act` is the single
switch that enables automated action on real Azure maintenance.

✅ **ADDRESSES:** a safe rollout path — deploy in observe, watch it make correct
decisions against real maintenance, then enable `act`.

---

## Step 8 — Real-time notifications to Teams (simulates ServiceNow / Google Chat)

This answers the "notify ServiceNow / Google Chat" requirement. The controller emits
a structured JSON event at **every** transition (`Detected → Cordoned → Drained →
SimulatedComplete`). We route those to an **Azure Logic App** which formats an
**Adaptive Card** and posts it to **Teams**. Swap the final hop and the same pipeline
delivers to ServiceNow or Google Chat instead — that's the point.

### Architecture (deployed default — built-in Teams connector)
```
controller (notify) --HTTP POST JSON--> Logic App (HTTP trigger)
   --> Compose Adaptive Card --> Teams built-in connector
       (PostCardToConversation) --> DM from 'Flow bot' to you in Teams
```
This is the **enterprise connector pattern** — the exact shape you'd use to wire real
ServiceNow (create incident) or Google Chat (post message): a managed **API
connection** authorized once with OAuth, then a first-class connector action. No
webhooks, no secrets in the payload.

### One-time deploy (already wired — `deploy.ps1` does this for you)
`deploy.ps1` calls `deploy-notifications.ps1` automatically; you do **not** run it
during the demo. It exists as a separate script so you can (re)wire the destination
later without rebuilding the cluster:
```powershell
# Full environment (cluster + controller + operator + notifications) in one shot:
.\deploy.ps1

# Or, if the cluster already exists and you just want to (re)wire notifications:
.\deploy-notifications.ps1 -RecipientEmail "you@example.com"
```
Either path deploys a **Teams API connection** (`aks-maint-teams`) + a **Consumption
Logic App** (`aks-maint-teams-notify`), reads the trigger's secured **callback URL**,
and sets `NOTIFICATION_WEBHOOK_URL` on the controller DaemonSet so every pod POSTs its
events to the Logic App.

### One-time authorize (the only manual step)
The Teams API connection deploys **unauthorized**. Authorize it once:
1. Portal → resource group `aks-maintenance-demo-rg` → API Connection
   **`aks-maint-teams`** → **Edit API connection** → **Authorize** → sign in → **Save**.
2. Status flips to **Connected**.

### During the demo — notifications are automatic
Once authorized, when `demo.ps1` injects an event the controller POSTs one
notification per transition on its own — you get one **Adaptive Card DM** per
transition (Detected/Cordoned/Drained/SimulatedComplete).

### Test the pipeline without running a full drain
```powershell
.\test-notification.ps1 -State "Detected"

# Confirm the action fired:
$subId = az account show --query id -o tsv
$run = az rest --method get --url "https://management.azure.com/subscriptions/$subId/resourceGroups/aks-maintenance-demo-rg/providers/Microsoft.Logic/workflows/aks-maint-teams-notify/runs?api-version=2019-05-01" --query "value[0].name" -o tsv
az rest --method get --url "https://management.azure.com/subscriptions/$subId/resourceGroups/aks-maintenance-demo-rg/providers/Microsoft.Logic/workflows/aks-maint-teams-notify/runs/$run/actions?api-version=2019-05-01" --query "value[].{action:name,status:properties.status}" -o table
```
`Post_card_to_Teams` = **Succeeded** means the DM was delivered.

### Alternative: Teams 'Workflows' webhook (no OAuth, posts to a channel)
```powershell
# In Teams: channel -> ... -> Workflows -> "Post to a channel when a webhook
# request is received" -> copy the URL, then:
.\deploy-notifications.ps1 -TeamsWebhookUrl "<paste-the-workflows-url>"
```
Microsoft is retiring classic O365 "Incoming Webhook" connectors; **Workflows**
(Power Automate) is the supported replacement.

✅ **ADDRESSES:** "optional outbound notifications: ServiceNow incident/work note;
Google Chat space message." The Logic App is the vendor-neutral integration hub —
Teams today, ServiceNow/Google Chat by swapping the final action.

---

## Step 9 — The central operator: store, dedup & dashboard

Steps 1–8 run from the per-node DaemonSet controller. But several requirements are
inherently *control-plane* concerns: keep one durable store across the whole fleet,
de-duplicate, and expose a dashboard. Those live in the **`maintenance-operator`**
Deployment (`maintenance_operator.py`) — a single replica with a **PersistentVolume**
(SQLite store) that is a **pure aggregation hub: it polls nothing and makes zero
Kubernetes API calls.** Every node's controller **POSTs** its transitions to the
operator's `/events`; the operator **normalizes + persists** and **de-duplicates**
repeats, then serves a **dashboard + JSON API**.

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

🎤 **SAY:**
> "You asked for control-plane things a per-node agent can't do well: a *durable*
> fleet-wide store, *dedupe* of repeat reports, and an operator *dashboard*. Let me
> run a Reboot end-to-end and watch it land in the store."

👀 **POINT AT** (call these out as they scroll):
1. It injects a **simulated IMDS Scheduled Event** of type **`Reboot`** — one of the
   only two types (`Reboot`, `Redeploy`) the controller ever acts on.
2. Controller log: **`Detected ... Reboot`** → **`Cordoned` → `Drained`** on the
   mapped node — the same safe drain as Step 4.
3. Each transition is **POSTed to the operator**, which prints the **persisted
   events** from its store.
4. It **re-POSTs the same report** and shows the **duplicate collapse** — the dedup
   counter climbs with **no second action** and **no second row**.

🎤 **SAY (on dedup):**
> "The second identical report did **not** cordon anything again — the operator
> recognized it as a duplicate and just incremented a counter. Every event is
> recorded once; actions never double-fire."

> The demo targets the node **not** running the operator, so the operator stays up and
> keeps recording through the drain. (In production it would sit on a separate system
> nodepool.)

### See the persistent store + dashboard (great screen-share)
```powershell
# API straight from the pod:
$op = kubectl get pods -n aks-maintenance-demo -l app=maintenance-operator -o jsonpath='{.items[0].metadata.name}'
kubectl exec $op -n aks-maintenance-demo -- python -c "import urllib.request;print(urllib.request.urlopen('http://localhost:8080/api/events').read().decode())"

# Or the visual dashboard in a browser (tunnel from pre-flight):
# open http://localhost:8080/   (auto-refreshes every 5s)
```
Because the store is on a **PVC**, it survives pod restarts — reschedule the operator
and the history is still there.

🧠 **HOW IT WORKS:** in production the controller reads a genuine IMDS Scheduled Event
from node-local `169.254.169.254`; here the event *source* is a ConfigMap so we can
trigger a Reboot/Redeploy on demand. Detect → cordon/drain → report → persist → dedup
is identical either way.

✅ **ADDRESSES:** VMSS→node mapping (#2), persistent normalized store + audit (#3),
deduplication (#4), and maintenance-action notification (#6).

---

## Step 10 — Lead-time scheduling (cordon *ahead* of the window)

You didn't just ask to cordon — you asked to cordon at a **configurable lead time
before** maintenance. The controller honors the event's `notBefore` and cordons
`leadSeconds` **before** the window, not on first sight.

```powershell
.\demo-leadtime.ps1 -WindowSeconds 120 -LeadSeconds 60
```

👀 **POINT AT:** the state prints **`Scheduled` repeatedly for ~60s** (and a
"Scheduled" Teams card fires, noting the planned cordon time), then flips to
`Cordoned → Drained → SimulatedComplete` exactly at window-minus-60s.

🧠 **HOW IT WORKS:** Scheduled Events carry a `NotBefore`; you decide how far ahead to
drain. Production default here is `LEAD_SECONDS=1800` (30 min) — comfortably inside the
~10–15 min real notice windows, or tune per event. The main `demo.ps1` uses a large
default so it acts immediately for a snappy walkthrough.

✅ **ADDRESSES:** "schedule + execute cordon at a configurable lead time" (#5).

---

## Step 11 — Operator visibility: the dashboard & API

🎤 **SAY:**
> "Last piece: operator visibility. Everything the operator sees is in a persistent
> store on a disk — it survives pod restarts — surfaced on a live dashboard and a
> JSON API."

⌨️ **DO:** switch to the browser tab **http://localhost:8080/** (already tunneled).

👀 **POINT AT:**
- **Tracked maintenance events** — every node's IMDS reports, normalized here as the
  fleet-wide view.
- **Upcoming maintenance actions** — the scheduling view (#8).
- **All normalized events** with **dedup counts** (#3/#4).
- **Action history** — the full audit trail; every Detect/Cordon/Drain/Complete.

⌨️ **DO** (optional — show it's an API, not just a page):
```powershell
Invoke-RestMethod http://localhost:8080/api/events | Format-Table event_id,event_type,target_node,last_state,dedup_count
Invoke-RestMethod http://localhost:8080/api/upcoming
```

🧠 **HOW IT WORKS:** the store sits on a **PersistentVolume** (Azure Disk via the CSI
driver); the Deployment can reschedule and the data follows. Because it's an API, it
drops straight into Grafana, Power BI, or your existing NOC tooling.

✅ **ADDRESSES:** persistent store + audit (#3), operator dashboard/API (#8).

---

## Close (3 min) — tie it back and make the ask

🎤 **SAY (scorecard):**
> "Against the list you sent, here's where we landed — all live, today:
> 1. Poll maintenance signals (IMDS Scheduled Events on every node) ✔
> 2. Map VMSS instance to AKS cluster + node ✔
> 3. Persistent, normalized store with action history ✔
> 4. Deduplication ✔
> 5. Cordon at a configurable lead time ✔
> 6. Maintenance-action (Reboot/Redeploy) notification ✔
> 7. Outbound ServiceNow / Google Chat (shown via Teams) ✔
> 8. Operator dashboard / API of upcoming actions ✔"

🎤 **SAY (real vs simulated — say this plainly):**
> "To be transparent about what you saw: the **Scheduled Events endpoint is real
> Azure**, live. The only thing I **simulate** is the *content* of a maintenance
> event — because I can't make Azure schedule a real redeploy on a call. Every
> downstream step — cordon, drain, PDB, notify, store, dedup, dashboard — is exactly
> what runs in production."

🎤 **SAY (production hardening):**
> "To productionize: package these two as scanned container images in ACR instead of
> pip-at-startup; back the store with Azure SQL/Cosmos or Log Analytics; run the
> operator on a system node pool; and wire the real ServiceNow + Google Chat actions
> into the Logic App we already proved with Teams. That's configuration and
> packaging — the pattern doesn't change."

🎤 **SAY (the ask / next steps):**
> "What I'd propose: I'll share this reference implementation and guide. You point it
> at a non-prod subscription, we validate against your actual node pools, and from
> there it's your call how deep to integrate with ServiceNow. And separately — the
> residual **pod-networking** issue after redeploy is a distinct investigation; I'd
> like to run that in parallel with CNI, EndpointSlice, load-balancer and conntrack
> evidence, not lump it in with maintenance."

---

## Anticipated questions (keep these ready)

- **"A VMSS scales up and down with load — won't a scale-in cause a false cordon?"**
  > "No, and this is the key design point. The *only* trigger is IMDS **Scheduled
  > Events**, and Azure never emits a `Reboot`/`Redeploy` for autoscaler scale
  > operations — those are ordinary VMSS deletes, not host maintenance. So a scale-in
  > can't produce an actionable event at all. The design is immune by construction —
  > no guardrails needed."

- **"Isn't this just `node-problem-detector`?"**
  > "NPD reports on-cluster symptoms *after* they happen. This acts on the Azure
  > *pre*-notification, before impact. They're complementary — NPD for the sudden,
  > no-notice failures; this for everything Azure announces ahead of time."

- **"Why not let AKS auto-drain / node auto-repair handle it?"**
  > "Those help, but they don't give you the lead-time control, the fleet-wide audit
  > store, dedup, or the ServiceNow/Chat notification you asked for. This is that
  > operational layer on top."

- **"What about zero-notice hardware death?"**
  > "No signal exists for that — the answer is resilience: PDBs, multi-node/zone
  > spread, fast reschedule. We reduce blast radius; we can't predict the
  > unpredictable."

- **"Does the controller ever act on a real event by accident?"**
  > "No — real events are `observe`-only until you deliberately set
  > `LIVE_ACTION_MODE=act`. On a live event it also acknowledges Azure *last*, only
  > after a clean drain."

- **"How much notice do we really get?"**
  > "Reboot/Freeze ~15 min, Redeploy ~10 min per the Scheduled Events contract. Your
  > `LEAD_SECONDS` just has to fit inside that."

---

## Reset between runs

`demo.ps1` self-resets, but to force a clean slate:
```powershell
kubectl patch configmap maintenance-demo-events -n aks-maintenance-demo --type merge --patch '{"data":{"event.json":""}}'
kubectl get nodes -o name | ForEach-Object { kubectl uncordon $_ }
kubectl rollout restart deployment/maintenance-demo-app -n aks-maintenance-demo
kubectl rollout status deployment/maintenance-demo-app -n aks-maintenance-demo
```

**Clear the operator store** (fresh dashboard for the next run):
```powershell
$op = kubectl get pods -n aks-maintenance-demo -l app=maintenance-operator -o jsonpath='{.items[0].metadata.name}'
kubectl exec $op -n aks-maintenance-demo -- python -c "import sqlite3;c=sqlite3.connect('/data/maintenance.db');c.execute('DELETE FROM events');c.execute('DELETE FROM history');c.commit();print('cleared')"
```

---

## Cost control (after the demo)

```powershell
az aks stop -g aks-maintenance-demo-rg -n aks-maintenance-demo   # pause: deallocate nodes, keep config
# or
.\cleanup.ps1                                                     # delete the resource group entirely
```
`az aks start` brings a stopped cluster back. `cleanup.ps1` tears down the cluster, the
`MC_*` node resource group, the VMSS, disks, and load balancer.

---

## Quick command cheat-sheet

| Purpose | Command |
| --- | --- |
| Connect | `az aks get-credentials -g aks-maintenance-demo-rg -n aks-maintenance-demo --overwrite-existing` |
| Cluster status | `az aks show -g aks-maintenance-demo-rg -n aks-maintenance-demo -o table` |
| Node status | `kubectl get nodes -o wide` |
| Pod placement | `kubectl get pods -n aks-maintenance-demo -o wide` |
| Run main scenario | `.\demo.ps1` |
| Run IMDS Reboot/Redeploy scenario | `.\demo-reboot.ps1` (or `-EventType Redeploy`) |
| Run lead-time scenario | `.\demo-leadtime.ps1 -WindowSeconds 120 -LeadSeconds 60` |
| Operator dashboard | `kubectl port-forward -n aks-maintenance-demo svc/maintenance-operator 8080:8080` → http://localhost:8080/ |
| Live IMDS check | see Step 6 |
| Deploy Teams notifications | `.\deploy-notifications.ps1 [-TeamsWebhookUrl '<url>']` |
| Test a notification | `.\test-notification.ps1 -State Cordoned` |
| Inspect result | `.\status.ps1` |
| Reset | see "Reset between runs" |
| Stop cluster | `az aks stop -g aks-maintenance-demo-rg -n aks-maintenance-demo` |
| Delete all | `.\cleanup.ps1` |

---

## Mapping the demo to the requirements

| Requirement | Where the demo answers it |
| --- | --- |
| Proactive maintenance awareness | Steps 4 & 6 — Scheduled Events detected before impact |
| Nodes still schedulable when maintenance starts | Step 4 — node cordoned before drain |
| Azure redeploys the node out from under AKS | Step 4 — controller front-runs Azure: drains first, acknowledges last |
| Residual pod/network impact after redeploy | Step 4 — graceful eviction + PDB + recovery; networking flagged as a separate, parallel investigation |
| No dedup / audit / history | Steps 5 & 9 — eventId dedup + JSON audit log + operator's persistent SQLite store & audit trail |
| Wants ServiceNow / Google Chat notifications | Step 8 — controller → Logic App → Teams Adaptive Card (swap final hop for ServiceNow/Google Chat) |
| Notification of maintenance actions (Reboot/Redeploy) | Steps 8 & 9 — controller notifies on every transition; operator records + surfaces them |
| Cordon at a configurable lead time before maintenance | Step 10 — controller holds in `Scheduled` and acts `leadSeconds` before `notBefore` |
| Operator visibility / dashboard of upcoming actions | Steps 9 & 11 — live dashboard + `/api/events`, `/api/upcoming` |
| Poor Azure support / needs an SME + existing patterns | Whole demo — proven Scheduled Events pattern + working reference implementation |

---

## Production hardening (if asked "is this production-ready?")

This is a **reference demo**, deliberately small — but it covers the whole in-scope
list (detect → map → persist → dedup → schedule → cordon/drain → notify → dashboard).
For production you'd:
- Package the controller **and operator** as versioned, scanned images in ACR (no
  `pip install` at pod start).
- Move the operator's SQLite store to a managed backing (Azure SQL / Cosmos / Log
  Analytics) and run the operator on a dedicated **system nodepool**.
- Add the real **ServiceNow + Google Chat** actions behind the same Logic App /
  `notify()` hop already proven with Teams.
- Consider the CNCF **`node-problem-detector`** + a reboot/drain manager, or Azure's
  own node auto-drain features, and compare against this Scheduled-Events approach.
- For **sudden** (no-notice) failures, lean on PDBs + multi-node/zone spread, since
  detection can't help when there's zero lead time.
