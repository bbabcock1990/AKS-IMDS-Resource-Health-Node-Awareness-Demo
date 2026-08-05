<#
.SYNOPSIS
    IMDS Scheduled Event (Reboot) scenario, end to end, with the operator store.

.DESCRIPTION
    The only automation trigger in this demo is an Azure IMDS Scheduled Event of
    an actionable type (Redeploy / Reboot). Resource Health is deliberately NOT a
    signal source -- it is reactive and fires on routine VMSS scale-in, so it is
    unsafe to automate off.

    This script injects a simulated IMDS *Reboot* Scheduled Event for one node
    into the maintenance-demo-events ConfigMap (the controller treats a non-IMDS
    source as a safe simulated event and runs the real cordon/drain path). It
    then shows the central operator, which every controller POSTs its state
    transitions to, acting as the fleet-wide:

      #3 persistent store    -> the event + every transition land in SQLite (PVC)
      #4 deduplication       -> repeat reports of the same event are collapsed
      #8 operator visibility -> dashboard / JSON API lists tracked + upcoming work

    Flow: inject Reboot event -> controller cordons + drains the node -> the
    operator store shows the tracked event and audit trail -> we prove dedup by
    re-reporting the same event -> reset.
#>
[CmdletBinding()]
param(
    [string]$Namespace = "aks-maintenance-demo",
    [ValidateSet("Reboot", "Redeploy")]
    [string]$EventType = "Reboot"
)

$ErrorActionPreference = "Stop"
$env:PATH = "$env:USERPROFILE\.azure-kubectl;$env:USERPROFILE\.azure-kubelogin;$env:PATH"

function Get-OperatorPod {
    kubectl get pods -n $Namespace -l app=maintenance-operator `
        -o jsonpath='{.items[0].metadata.name}'
}

# Target the node that hosts the most demo workload but NOT the operator, so the
# operator stays up and keeps ingesting reports while its target is drained.
$operatorNode = kubectl get pods -n $Namespace -l app=maintenance-operator `
    -o jsonpath='{.items[0].spec.nodeName}'
$workload = kubectl get pods -n $Namespace -l app=maintenance-demo-app -o json | ConvertFrom-Json
$targetNode = $workload.items |
    Where-Object { $_.spec.nodeName -ne $operatorNode } |
    Group-Object -Property { $_.spec.nodeName } |
    Sort-Object Count -Descending |
    Select-Object -First 1 -ExpandProperty Name
if (-not $targetNode) {
    $targetNode = (kubectl get nodes -o json | ConvertFrom-Json).items |
        Where-Object { $_.metadata.name -ne $operatorNode } |
        Select-Object -First 1 -ExpandProperty metadata | Select-Object -ExpandProperty name
}
if (-not $targetNode) { throw "No AKS nodes were found." }

$eventId = "imds-" + [guid]::NewGuid().ToString("N").Substring(0, 8)
$event = @{
    eventId     = $eventId
    targetNode  = $targetNode
    eventType   = $EventType
    eventStatus = "Scheduled"
    source      = "DemoSimulator"
    notBefore   = (Get-Date).ToUniversalTime().AddMinutes(15).ToString("o")
    description = "Simulated Azure IMDS Scheduled Event ($EventType) for the AKS maintenance demonstration."
} | ConvertTo-Json -Compress
$patch = @{ data = @{ "event.json" = $event } } | ConvertTo-Json -Compress

Write-Host "=== IMDS Scheduled Event ($EventType) demo ===" -ForegroundColor Cyan
Write-Host "Target node: $targetNode"
Write-Host "Event id   : $eventId"
Write-Host ""
Write-Host "Before:" -ForegroundColor Yellow
kubectl get nodes
kubectl get pods -n $Namespace -o wide -l app=maintenance-demo-app

Write-Host ""
Write-Host "Injecting a simulated IMDS '$EventType' Scheduled Event into ConfigMap" -ForegroundColor Yellow
Write-Host "maintenance-demo-events (stands in for the node-local IMDS endpoint)..."
kubectl patch configmap maintenance-demo-events -n $Namespace --type merge --patch $patch | Out-Null

Write-Host ""
Write-Host "Waiting for the controller to cordon + drain the node..." -ForegroundColor Yellow
$deadline = (Get-Date).AddMinutes(6)
do {
    Start-Sleep -Seconds 3
    $state = kubectl get node $targetNode `
        -o jsonpath='{.metadata.annotations.maintenance\.demo/state}'
    Write-Host "Controller state: $state"
} until ($state -eq "SimulatedComplete" -or (Get-Date) -gt $deadline)

Write-Host ""
Write-Host "Controller transitions (each also POSTed to the operator + Teams):" -ForegroundColor Yellow
$pod = kubectl get pods -n $Namespace -l app=maintenance-controller `
    --field-selector "spec.nodeName=$targetNode" `
    -o jsonpath='{.items[0].metadata.name}'
kubectl logs $pod -n $Namespace --since 6m --tail 60 | Select-String -Pattern "MAINTENANCE_EVENT"

Write-Host ""
Write-Host "Operator store (#3) -- the controller's reports, normalized + deduped (#4):" -ForegroundColor Yellow
$op = Get-OperatorPod
kubectl exec $op -n $Namespace -- python -c "import urllib.request,json; d=json.load(urllib.request.urlopen('http://localhost:8080/api/events')); [print('  ', e['event_id'], e['event_type'], e['target_node'], 'state=',e['last_state'], 'reports=',e['dedup_count']) for e in d]"

Write-Host ""
Write-Host "Demonstrating DEDUPLICATION (#4): re-reporting the SAME event..." -ForegroundColor Yellow
$dup = @{ node = $targetNode; eventId = $eventId; eventType = $EventType; source = "DemoSimulator"; state = "SimulatedComplete"; detail = "duplicate report (dedup demo)" } | ConvertTo-Json -Compress
$py = "import urllib.request,json; body=json.loads(r'''$dup'''); req=urllib.request.Request('http://localhost:8080/events', data=json.dumps(body).encode(), headers={'Content-Type':'application/json'}); print('  post:', urllib.request.urlopen(req).read().decode())"
kubectl exec $op -n $Namespace -- python -c $py
Start-Sleep -Seconds 1
kubectl exec $op -n $Namespace -- python -c "import urllib.request,json; d=json.load(urllib.request.urlopen('http://localhost:8080/api/events')); e=[x for x in d if x['event_id']=='$eventId'][0]; print('  reports for $eventId is now', e['dedup_count'], '(duplicate collapsed into the single event -- no new row, no second action)')"

Write-Host ""
Write-Host "After (node cordoned, workload rescheduled):" -ForegroundColor Yellow
kubectl get nodes
kubectl get pods -n $Namespace -o wide -l app=maintenance-demo-app

Write-Host ""
Write-Host "Resetting the scenario..." -ForegroundColor Yellow
kubectl patch configmap maintenance-demo-events -n $Namespace --type merge --patch '{"data":{"event.json":""}}' | Out-Null
kubectl uncordon $targetNode | Out-Null
kubectl annotate node $targetNode `
    maintenance.demo/event-id- maintenance.demo/event-type- `
    maintenance.demo/event-source- maintenance.demo/state- `
    maintenance.demo/updated-at- 2>$null | Out-Null
kubectl rollout restart deployment/maintenance-demo-app -n $Namespace | Out-Null
kubectl rollout status deployment/maintenance-demo-app -n $Namespace --timeout 3m

Write-Host ""
Write-Host "Done. Open the live dashboard (#8) with:" -ForegroundColor Green
Write-Host "  kubectl port-forward -n $Namespace svc/maintenance-operator 8080:8080" -ForegroundColor Green
Write-Host "  then browse http://localhost:8080/" -ForegroundColor Green
