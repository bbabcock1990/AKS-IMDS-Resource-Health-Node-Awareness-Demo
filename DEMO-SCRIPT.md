# AKS Maintenance — Demo Presentation Script (with talking tracks)

**Audience:** Customer team · **Presenter:** AKS SME
**Duration:** ~35–40 min demo + Q&A · **Format:** live Azure + Teams

> This is the **run-of-show**: what to *say* (talking track, in quotes), what to
> *do* (commands), what to *point at*, the **Azure concept** behind it, and the
> **concern it answers**. The companion `DEMO-RUNBOOK.md` is the command
> reference; this file is the narration you perform top-to-bottom.

---

## How to read each step

- 🎤 **SAY** — the talking track (say it in your own words; this is the intent).
- ⌨️ **DO** — the command(s) to run.
- 👀 **POINT AT** — what to draw their eye to on screen.
- 🧠 **AZURE CONCEPT** — the underlying platform behavior to teach.
- ✅ **ADDRESSES** — which of the customer's asks this closes.

---

## Pre-flight (5 min before the call — do NOT screen-share yet)

⌨️ **DO** — one terminal, get everything warm:
```powershell
cd "$env:USERPROFILE\OneDrive - Microsoft\Desktop\AKS-Maintance-Demo"
$env:PATH = "$env:USERPROFILE\.azure-kubectl;$env:USERPROFILE\.azure-kubelogin;$env:PATH"
az account set --subscription 00000000-0000-0000-0000-000000000000
az aks get-credentials -g aks-maintenance-demo-rg -n aks-maintenance-demo --overwrite-existing
kubectl get nodes                              # both Ready
kubectl get pods -n aks-maintenance-demo -o wide   # controller 2/2, operator 1/1, app 4/4
```
- Confirm the **Teams connection is Connected** (Portal → RG → `aks-maint-teams`).
- Start the **dashboard tunnel** in a *second* terminal and leave it running:
  ```powershell
  kubectl port-forward -n aks-maintenance-demo svc/maintenance-operator 8080:8080
  ```
- Open browser tabs: **http://localhost:8080/** , the Azure Portal on the cluster,
  and **Teams** (so the card DM is visible when it lands).
- Have `.\demo.ps1`, `.\demo-reboot.ps1`, `.\demo-leadtime.ps1` ready to paste.

> If anything looks off, `.\deploy.ps1` rebuilds the whole environment idempotently.

---

## Opening (2 min) — frame the problem in *their* words

🎤 **SAY:**
> "I want to start by stating your problem back to you so you know we're
> aligned. Azure treats every AKS node as a VM in a Scale Set. When Azure has to
> service the underlying hardware — a **reboot** or a **redeploy** — it does that
> maintenance on the VM. If nothing on the
> Kubernetes side is *listening*, Azure can move that node out from under AKS
> while your pods are still running on it. That's the rug-pull you're seeing, and
> the residual pod-networking mess afterward.
>
> The good news: **Azure announces almost all of this before it happens**, on a
> signal called Scheduled Events. Nobody's job by default is to listen to that and
> translate it into a Kubernetes action. So today I'm going to show you a small,
> safe reference implementation that does exactly that — and I'll be explicit about
> what's real Azure behavior versus what I'm simulating so we can trigger it on a
> call."

🎤 **SAY (set the through-line):**
> "The whole demo is one loop: **Detect → Cordon → Drain → Acknowledge → Recover.**
> Then I'll layer on the operational pieces you asked for: subscription-wide
> polling, a persistent audit store, deduplication, hardware-failure alerts,
> scheduling *ahead* of the window, and a dashboard."

🧠 **AZURE CONCEPT:** AKS node pools are VM Scale Sets; the AKS control plane is
managed, but the *nodes* are VMs subject to platform maintenance.

---

## Act 1 — The Azure reality (5 min)

### 1a. An AKS node IS a VMSS VM

🎤 **SAY:**
> "Let's ground this in the platform. These two Kubernetes nodes are literally two
> VMs in a Scale Set that AKS created. Same object Azure schedules maintenance on."

⌨️ **DO:**
```powershell
kubectl get nodes -o wide
$nodeRg = az aks show -g aks-maintenance-demo-rg -n aks-maintenance-demo --query nodeResourceGroup -o tsv
az vmss list -g $nodeRg -o table
```
👀 **POINT AT:** the node names line up with VMSS instances.
🧠 **AZURE CONCEPT:** the **node resource group** (`MC_*`) holds the VMSS, disks,
and load balancer AKS manages on your behalf.
✅ **ADDRESSES:** why AKS gets "surprised" — the maintenance target is the VM, not
the Kubernetes node.

### 1b. Resource Health — the signal you're frustrated with

🎤 **SAY:**
> "You quoted the Resource Health doc — the 'Degraded means predicted hardware
> failure' line — and said it's inaccurate because you *also* see Degraded on
> scale-down. You're right, and here's the nuance: Resource Health is a **health
> narrative**, not a machine-actionable maintenance instruction. It's great for a
> human dashboard and for genuine hardware degradation, but it's noisy and you
> can't reliably *automate* off it alone. That's exactly why we don't hang the
> automation on it."

⌨️ **DO** (real call — this is live Azure, returns `Available` today):
```powershell
$nodeRg = az aks show -g aks-maintenance-demo-rg -n aks-maintenance-demo --query nodeResourceGroup -o tsv
$vmssId = az vmss list -g $nodeRg --query "[0].id" -o tsv
az rest --method get `
  --url "https://management.azure.com$vmssId/providers/Microsoft.ResourceHealth/availabilityStatuses/current?api-version=2020-05-01" `
  --query "{status:properties.availabilityState, summary:properties.summary, changed:properties.occuredTime}" -o table
```
👀 **POINT AT:** `status: Available` — healthy baseline.
🧠 **AZURE CONCEPT:** **Resource Health** (`Microsoft.ResourceHealth`) reports
Available / Degraded / Unavailable per resource. Needs a one-time
`az provider register --namespace Microsoft.ResourceHealth` on the subscription.
✅ **ADDRESSES:** the customer's #1 complaint (the docs oversell "Degraded"). We agree —
and we treat Resource Health as an *awareness signal for humans only*; the
automation **excludes it entirely** and acts solely on Scheduled Events.

🎤 **SAY (bridge to the real trigger):**
> "So if Resource Health isn't the trigger, what is? **Scheduled Events** — a
> per-VM signal that says 'a Reboot or Redeploy is coming, and here's roughly how
> long you have.' That IS machine-actionable, and it's the *only* thing the
> controller acts on."

---

## Act 2 — The controller & the safe drain (8 min) ⟵ *the core*

### 2a. What we're protecting

🎤 **SAY:**
> "Here's a stand-in for your workload — a small web deployment across both nodes,
> with a **Pod Disruption Budget** that says 'never take me below 2 available.'
> That PDB is the safety contract the drain will respect."

⌨️ **DO:**
```powershell
kubectl get pods -n aks-maintenance-demo -o wide -l app=maintenance-demo-app
kubectl get pdb -n aks-maintenance-demo
```
👀 **POINT AT:** pods spread across both nodes; `minAvailable: 2`.
🧠 **AZURE CONCEPT / K8s:** a **PodDisruptionBudget** makes *voluntary* evictions
(like a drain) honor availability — the eviction API blocks if it would breach it.

### 2b. The controller and its safety model

🎤 **SAY:**
> "The listener is a **DaemonSet** — one pod on every node — called
> `maintenance-controller`. Each pod watches *its own* node's signal. Two safety
> defaults matter to you: first, real Azure events are **observe-only** by default —
> it will *tell* you but not act until you flip one env var to `act`. Second, its
> RBAC is scoped to exactly cordon/drain — it can't touch the Scale Set or system
> workloads."

⌨️ **DO:**
```powershell
kubectl get daemonset -n aks-maintenance-demo
kubectl set env daemonset/maintenance-controller -n aks-maintenance-demo --list | Select-String "LIVE_ACTION_MODE|LEAD_SECONDS|WEBHOOK|STORE"
```
👀 **POINT AT:** `LIVE_ACTION_MODE=observe` — the safety switch.
✅ **ADDRESSES:** "I don't want Azure ripping nodes out from under me" — *we*
front-run Azure, on our terms, safely.

### 2c. Run the main scenario

🎤 **SAY:**
> "I'll inject a simulated **Redeploy** Scheduled Event against the busiest node —
> same shape Azure delivers — and we watch the controller react. Keep your eye on
> the node status and where the pods are."

⌨️ **DO:**
```powershell
.\demo.ps1
```
👀 **POINT AT**, in order:
- node flips to **`SchedulingDisabled`** (that's the **cordon** — no *new* pods land);
- app pods get **evicted and reappear on the other node** (the **drain**);
- the state annotation walks **Detected → Cordoned → Drained → SimulatedComplete**;
- **PDB kept ≥2 running the entire time** — no outage.

🎤 **SAY (narrate as it runs):**
> "Cordon first — stop the bleeding, no new work lands here. Then a graceful drain
> using the Kubernetes **Eviction API**, which respects that PDB. Pods reschedule
> onto the healthy node. Only *after* the node is safely empty would we tell Azure
> 'go ahead.' We turned a pull-the-rug into a planned migration — and nothing you'd
> have paged on."

🧠 **AZURE CONCEPT:** this is the automation equivalent of draining before you let
platform maintenance proceed; `cordon` = `spec.unschedulable=true`, `drain` = evict
non-daemonset pods honoring PDBs.
✅ **ADDRESSES:** proactive awareness, nodes-still-schedulable-at-maintenance, and
the redeploy-out-from-under-AKS problem — all three at once.

---

## Act 3 — Prove the real Azure signal is live (3 min)

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
🧠 **AZURE CONCEPT:** **Scheduled Events** via **IMDS** at the non-routable
`169.254.169.254` — every Azure VM has it, no credentials needed. The throwaway pod
runs on the **host network** because IMDS is link-local (only reachable from the
node's own netns) — the same reason the controller uses `hostNetwork: true`.
Reboot/Freeze typically give **~15 min** notice; Redeploy **~10 min**; Spot preempt
**~30 sec**.
✅ **ADDRESSES:** "is this smoke and mirrors?" — no; the production trigger is live,
we simulate only the *content* so we can demo on demand.

🎤 **SAY (important honesty):**
> "One caveat I'll never hide from you: **sudden, unpredicted hardware death gives
> zero notice** — no signal can help there. For that case the answer is resilience:
> PDBs, spread across nodes/zones, fast reschedule. Everything *predicted or
> planned*, though, we catch ahead of time."

---

## Act 4 — IMDS Reboot/Redeploy, end-to-end via the operator (7 min)

🎤 **SAY (introduce the second component):**
> "Everything so far was the per-node listener. But you asked for control-plane
> things a per-node agent can't do well: keep a *durable* fleet-wide store,
> *dedupe* repeat reports, and give operators a *dashboard*. That's a second
> component — `maintenance-operator` — a single Deployment with a persistent disk.
> It polls nothing; every node's controller *reports* its transitions to it. Let
> me run a Reboot end-to-end and watch it land in the store."

⌨️ **DO:**
```powershell
.\demo-reboot.ps1            # or: .\demo-reboot.ps1 -EventType Redeploy
```
👀 **POINT AT** (call these out as they scroll):
1. It injects a **simulated IMDS Scheduled Event** of type **`Reboot`** — one of
   the only two types (`Reboot`, `Redeploy`) the controller ever acts on.
2. Controller log: **`Detected ... Reboot`** → **`Cordoned` → `Drained`** on the
   mapped node — the same safe drain from Act 2.
3. Each transition is **POSTed to the operator**, which prints the **persisted
   events** from its store.
4. It **re-POSTs the same report** and shows the **duplicate collapse** — the
   dedup counter climbs with **no second action** and **no second row**.

🎤 **SAY (on the notification):**
> "Each transition is also a notification. Today it's a Teams DM; the exact same
> Logic App step becomes a **ServiceNow incident** or a **Google Chat** post by
> swapping one action — nothing upstream changes. That's your 'notify ServiceNow /
> Google Chat' box, checked."

🎤 **SAY (on dedup):**
> "Notice the second identical report did **not** cordon anything again — the
> operator recognized it as a duplicate and just incremented a counter. That's the
> deduplication and audit requirement: every event is recorded once, actions never
> double-fire."

🎤 **SAY (pre-empt the autoscaling question):**
> "And because the only trigger is IMDS Scheduled Events, a routine autoscaler
> scale-in **cannot** create a false event here — IMDS simply never emits a
> Reboot/Redeploy for scaling. No guardrails needed; the design is immune by
> construction. That's exactly why we dropped Resource Health as a trigger."

🧠 **AZURE CONCEPT:** in production the controller reads a genuine IMDS Scheduled
Event from node-local `169.254.169.254`; here the event source is a ConfigMap so we
can trigger it on demand. Detect → cordon/drain → report → persist → dedup is
identical either way.
✅ **ADDRESSES:** VMSS→node mapping (#2), persistent store + audit (#3), dedup (#4),
maintenance-action notification (#6).

---

## Act 5 — Scheduling *ahead* of the window (4 min)

🎤 **SAY:**
> "You didn't just ask to cordon — you asked to cordon at a **configurable lead
> time before** maintenance. So the controller doesn't act the instant it sees the
> event; it reads the maintenance window's `notBefore` and acts `leadSeconds`
> before it. Watch it *wait* in a 'Scheduled' state, then act right at the boundary."

⌨️ **DO:**
```powershell
.\demo-leadtime.ps1 -WindowSeconds 120 -LeadSeconds 60
```
👀 **POINT AT:** the state prints **`Scheduled` repeatedly for ~60s**, then flips to
`Cordoned → Drained → SimulatedComplete` exactly at window-minus-60s. A **"Scheduled"
Teams card** also fires, noting the planned cordon time.
🧠 **AZURE CONCEPT:** Scheduled Events carry a `NotBefore`; you decide how far ahead
to drain. Production default here is `LEAD_SECONDS=1800` (30 min) — comfortably
inside the ~10–15 min real notice windows, or tune per event.
✅ **ADDRESSES:** "schedule + execute cordon at a configurable lead time" (#5).

---

## Act 6 — Operator visibility: the dashboard & store (3 min)

🎤 **SAY:**
> "Last piece you asked for: operator visibility. Everything the operator sees and
> does is in a **persistent store on a disk** — it survives pod restarts — and it's
> surfaced on a live dashboard and a JSON API."

⌨️ **DO:** switch to the browser tab **http://localhost:8080/** (already tunneled).
👀 **POINT AT:**
- **Subscriptions polled** — your prod + dev lists (#1).
- **Upcoming maintenance actions** — the scheduling view (#8).
- **All normalized events** with **dedup counts** (#3/#4).
- **Action history** — the full audit trail; every Detect/Cordon/Drain/Complete.

⌨️ **DO** (optional — show it's an API, not just a page):
```powershell
# from anywhere with the tunnel up:
Invoke-RestMethod http://localhost:8080/api/events | Format-Table event_id,event_type,target_node,last_state,dedup_count
Invoke-RestMethod http://localhost:8080/api/upcoming
```
🎤 **SAY:**
> "Because it's an API, this drops straight into Grafana, a Power BI board, or your
> existing NOC tooling. And because the store is durable, you get the dedup +
> audit history you asked for, not just ephemeral logs."
🧠 **AZURE CONCEPT / K8s:** the store sits on a **PersistentVolume** (Azure Disk via
the CSI driver); the Deployment can reschedule and the data follows.
✅ **ADDRESSES:** persistent store + audit (#3), operator dashboard/API (#8).

---

## Close (3 min) — tie it back and make the ask

🎤 **SAY (scorecard):**
> "So against the list you sent, here's where we landed — all live, today:
> 1. Poll maintenance signals (IMDS Scheduled Events on every node) ✔
> 2. Map VMSS instance to AKS cluster + node ✔
> 3. Persistent, normalized store with action history ✔
> 4. Deduplication ✔
> 5. Cordon at a configurable lead time ✔
> 6. Maintenance-action (Reboot/Redeploy) notification ✔
> 7. Outbound ServiceNow / Google Chat (shown via Teams) ✔
> 8. Operator dashboard / API of upcoming actions ✔"

🎤 **SAY (real vs simulated — say this plainly):**
> "To be completely transparent about what you just saw: the **Scheduled Events
> endpoint is real Azure**, live. The only thing I **simulate** is the *content* of
> a maintenance event — because I can't make Azure schedule a real redeploy on a
> call. Every downstream step — cordon, drain, PDB, notify, store, dedup, dashboard
> — is exactly what runs in production."

🎤 **SAY (what production hardening looks like):**
> "To productionize: package these two as scanned container images in ACR instead of
> pip-at-startup; back the store with Azure SQL/Cosmos or Log Analytics; run the
> operator on a system node pool; and wire the real ServiceNow + Google Chat actions
> into the Logic App we already proved with Teams. That's configuration and
> packaging — the pattern you saw doesn't change."

🎤 **SAY (the ask / next steps):**
> "What I'd propose: I'll share this reference implementation and runbook. You point
> it at a non-prod subscription of yours, we validate against your actual node
> pools. From there it's your call how deep to integrate with ServiceNow. And separately — the residual **pod-networking**
> issue after redeploy is a real, distinct investigation; I'd like to run that in
> parallel with CNI, EndpointSlice, load-balancer and conntrack evidence, not lump
> it in with maintenance."

---

## Anticipated questions (keep these ready)

- **"A VMSS scales up and down with load — won't a scale-in cause a false cordon?"**
  > "No, and this is the key design point. The *only* trigger is IMDS **Scheduled
  > Events**, and Azure never emits a Reboot/Redeploy for autoscaler scale
  > operations — those are ordinary VMSS deletes, not host maintenance. So a
  > scale-in can't produce an actionable event at all. That's precisely why we
  > **removed Resource Health** as a trigger: its 'Degraded' state *does* flicker
  > on scale-in, which is exactly the false positive you were worried about."

- **"Isn't this just `node-problem-detector`?"**
  > "NPD reports on-cluster symptoms *after* they happen. This acts on the Azure
  > *pre*-notification, before impact. They're complementary — NPD for the sudden,
  > no-notice failures; this for everything Azure announces ahead of time."

- **"Why not let AKS auto-drain / node auto-repair handle it?"**
  > "Those help, but they don't give you the lead-time control, the fleet-wide
  > audit store, dedup, or the ServiceNow/Chat notification you asked for. This is
  > that operational layer on top."

- **"What about zero-notice hardware death?"**
  > "No signal exists for that — the answer is resilience: PDBs, multi-node/zone
  > spread, fast reschedule. We reduce blast radius; we can't predict the
  > unpredictable."

- **"Does the controller ever act on a real event by accident?"**
  > "No — real events are `observe`-only until you deliberately set `LIVE_ACTION_MODE=act`.
  > On a live event it also acknowledges Azure *last*, only after a clean drain."

- **"How much notice do we really get?"**
  > "Reboot/Freeze ~15 min, Redeploy ~10 min per the Scheduled Events contract. Your
  > `LEAD_SECONDS` just has to fit inside that."

---

## Appendix — reset & cost

**Reset between takes** (each demo script self-resets, but to force clean):
```powershell
kubectl patch configmap maintenance-demo-events -n aks-maintenance-demo --type merge --patch '{"data":{"event.json":""}}'
kubectl get nodes -o name | ForEach-Object { kubectl uncordon $_ }
kubectl rollout restart deployment/maintenance-demo-app -n aks-maintenance-demo
```

**Clear the operator store** (fresh dashboard for the next run):
```powershell
$op = kubectl get pods -n aks-maintenance-demo -l app=maintenance-operator -o jsonpath='{.items[0].metadata.name}'
kubectl exec $op -n aks-maintenance-demo -- python -c "import sqlite3;c=sqlite3.connect('/data/maintenance.db');c.execute('DELETE FROM events');c.execute('DELETE FROM history');c.commit();print('cleared')"
```

**Stop paying after the call:**
```powershell
az aks stop -g aks-maintenance-demo-rg -n aks-maintenance-demo   # pause (keep config)
# or
.\cleanup.ps1                                                     # delete everything
```

---

## One-glance run order

| # | Act | Command | The "wow" |
| --- | --- | --- | --- |
| 0 | Pre-flight | `deploy.ps1` (if needed) + port-forward | everything green |
| 1 | Azure reality | `kubectl get nodes` / Resource Health `az rest` | node = VMSS VM; "Degraded" explained |
| 2 | Safe drain | `.\demo.ps1` | cordon→drain, PDB holds, zero outage |
| 3 | Real signal | IMDS `scheduledevents` curl | the live trigger is real |
| 4 | IMDS Reboot/Redeploy | `.\demo-reboot.ps1` | controller drain + operator store + dedup |
| 5 | Lead time | `.\demo-leadtime.ps1` | waits in `Scheduled`, acts on time |
| 6 | Visibility | browser → http://localhost:8080/ | store, upcoming, audit, dedup |
| 7 | Close | — | scorecard + ask |
