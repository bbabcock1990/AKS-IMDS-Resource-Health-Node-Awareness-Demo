<#
.SYNOPSIS
    Hardware-failure ("Degraded") scenario driven by the central operator.

.DESCRIPTION
    Demonstrates the gaps the per-node controller can't cover on its own:
      #1 subscription-list polling      -> operator polls prod/dev subscriptions
      #2 VMSS instance -> node mapping   -> signal carries the resolved node
      #3 persistent normalized store     -> event lands in the operator's SQLite
      #4 deduplication                   -> re-injecting the same signal is ignored
      #6 hardware-failure notification   -> Teams card fires on detection
      #8 operator visibility             -> dashboard/API lists the action

    Flow: inject a Resource Health "Degraded" signal into the
    maintenance-resource-health ConfigMap -> the operator normalizes + stores it,
    notifies Teams, and drives the DaemonSet controller to cordon/drain the node.
#>
[CmdletBinding()]
param(
    [string]$Namespace = "aks-maintenance-demo"
)

$ErrorActionPreference = "Stop"
$env:PATH = "$env:USERPROFILE\.azure-kubectl;$env:USERPROFILE\.azure-kubelogin;$env:PATH"

function Get-OperatorPod {
    kubectl get pods -n $Namespace -l app=maintenance-operator `
        -o jsonpath='{.items[0].metadata.name}'
}

# Pick the node that hosts the most demo workload but NOT the operator, so the
# operator stays up (and its store keeps recording) while its target is drained.
$operatorNode = kubectl get pods -n $Namespace -l app=maintenance-operator `
    -o jsonpath='{.items[0].spec.nodeName}'
$workload = kubectl get pods -n $Namespace -l app=maintenance-demo-app -o json | ConvertFrom-Json
$targetNode = $workload.items |
    Where-Object { $_.spec.nodeName -ne $operatorNode } |
    Group-Object -Property { $_.spec.nodeName } |
    Sort-Object Count -Descending |
    Select-Object -First 1 -ExpandProperty Name
if (-not $targetNode) {
    # Fallback: any node other than the operator's.
    $targetNode = (kubectl get nodes -o json | ConvertFrom-Json).items |
        Where-Object { $_.metadata.name -ne $operatorNode } |
        Select-Object -First 1 -ExpandProperty metadata | Select-Object -ExpandProperty name
}
if (-not $targetNode) { throw "No AKS nodes were found." }

$eventId = "rh-" + [guid]::NewGuid().ToString("N").Substring(0, 8)
$signals = @{
    value = @(
        @{
            id          = $eventId
            subscription = "00000000-0000-0000-0000-000000000000"
            targetNode  = $targetNode
            notBefore   = (Get-Date).ToUniversalTime().AddMinutes(15).ToString("o")
            leadSeconds = 900
            properties  = @{
                availabilityState = "Degraded"
                summary           = "Azure predicts a hardware failure on the host server (VirtualMachinePossiblyDegradedDueToHardwareFailure)."
                reasonType        = "Unplanned"
            }
        }
    )
} | ConvertTo-Json -Depth 6 -Compress

$patch = @{ data = @{ "signals.json" = $signals } } | ConvertTo-Json -Compress

Write-Host "=== Hardware-failure (Degraded) demo ===" -ForegroundColor Cyan
Write-Host "Target node: $targetNode"
Write-Host "Event id   : $eventId"
Write-Host ""
Write-Host "Before:" -ForegroundColor Yellow
kubectl get nodes
kubectl get pods -n $Namespace -o wide -l app=maintenance-demo-app

Write-Host ""
Write-Host "Injecting a Resource Health 'Degraded' signal into ConfigMap" -ForegroundColor Yellow
Write-Host "maintenance-resource-health (simulates Azure Resource Health)..."
kubectl patch configmap maintenance-resource-health -n $Namespace --type merge --patch $patch | Out-Null

Write-Host ""
Write-Host "Waiting for the operator to detect + drive cordon/drain..." -ForegroundColor Yellow
$deadline = (Get-Date).AddMinutes(6)
do {
    Start-Sleep -Seconds 3
    $state = kubectl get node $targetNode `
        -o jsonpath='{.metadata.annotations.maintenance\.demo/state}'
    Write-Host "Controller state: $state"
} until ($state -eq "SimulatedComplete" -or (Get-Date) -gt $deadline)

Write-Host ""
Write-Host "Operator log (detection + notify + cordon wiring):" -ForegroundColor Yellow
$op = Get-OperatorPod
kubectl logs $op -n $Namespace --tail 40 | Select-String -Pattern "Poller started|Polling|Detected|HARDWARE_EVENT|Drove cordon"

Write-Host ""
Write-Host "Persisted events in the operator store (API /api/events):" -ForegroundColor Yellow
kubectl exec $op -n $Namespace -- python -c "import urllib.request,json; d=json.load(urllib.request.urlopen('http://localhost:8080/api/events')); [print('  ', e['event_id'], e['event_type'], e['target_node'], 'state=',e['last_state'], 'dupes=',e['dedup_count']) for e in d]"

Write-Host ""
Write-Host "Demonstrating DEDUPLICATION (#4): re-injecting the SAME signal..." -ForegroundColor Yellow
kubectl patch configmap maintenance-resource-health -n $Namespace --type merge --patch $patch | Out-Null
Start-Sleep -Seconds 8
kubectl exec $op -n $Namespace -- python -c "import urllib.request,json; d=json.load(urllib.request.urlopen('http://localhost:8080/api/events')); e=[x for x in d if x['event_id']=='$eventId'][0]; print('  dedup_count is now', e['dedup_count'], '(second sighting suppressed, no duplicate action)')"

Write-Host ""
Write-Host "After (node cordoned, workload rescheduled):" -ForegroundColor Yellow
kubectl get nodes
kubectl get pods -n $Namespace -o wide -l app=maintenance-demo-app

Write-Host ""
Write-Host "Resetting the scenario..." -ForegroundColor Yellow
kubectl patch configmap maintenance-resource-health -n $Namespace --type merge --patch '{"data":{"signals.json":"{\"value\": []}"}}' | Out-Null
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
