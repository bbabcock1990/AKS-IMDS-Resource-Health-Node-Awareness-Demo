<#
.SYNOPSIS
    False-positive guardrail scenario: a routine VMSS scale-in surfaces a
    transient Resource Health "Degraded" -- and the operator correctly SKIPS it
    (no cordon, no drain).

.DESCRIPTION
    A VMSS-backed AKS node pool scales in/out with load. A routine scale-in can
    briefly report availabilityState="Degraded" in Resource Health. Acting on
    that would cordon a healthy node for no reason.

    The operator applies guardrails before it ever drives a cordon:
      * REQUIRE_UNPLANNED       - a Degraded must be reasonType=Unplanned
      * HARDWARE_SUMMARY_PATTERN - its summary must look like a hardware fault
      * SKIP_AUTOSCALER_NODES   - never fight a node the autoscaler is retiring
      * CONFIRM_POLLS           - the signal must persist for N polls

    This script injects a scale-in-shaped Degraded signal (reasonType=Planned,
    summary="Instance scaled in by cluster autoscaler") and shows the operator
    log the SKIP while the node stays Ready and uncordoned. Contrast with
    demo-hardware.ps1, whose genuine hardware Degraded DOES drive a cordon.
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

# Target a node other than the operator's, exactly like the hardware demo, so we
# are comparing apples to apples -- the only difference is the signal's shape.
$operatorNode = kubectl get pods -n $Namespace -l app=maintenance-operator `
    -o jsonpath='{.items[0].spec.nodeName}'
$targetNode = (kubectl get nodes -o json | ConvertFrom-Json).items |
    Where-Object { $_.metadata.name -ne $operatorNode } |
    Select-Object -First 1 -ExpandProperty metadata | Select-Object -ExpandProperty name
if (-not $targetNode) { throw "No AKS nodes were found." }

$eventId = "rh-scalein-" + [guid]::NewGuid().ToString("N").Substring(0, 8)
$signals = @{
    value = @(
        @{
            id          = $eventId
            subscription = "00000000-0000-0000-0000-000000000000"
            targetNode  = $targetNode
            notBefore   = (Get-Date).ToUniversalTime().ToString("o")
            leadSeconds = 0
            properties  = @{
                availabilityState = "Degraded"
                summary           = "Instance scaled in by cluster autoscaler in response to reduced load."
                reasonType        = "Planned"
            }
        }
    )
} | ConvertTo-Json -Depth 6 -Compress

$patch = @{ data = @{ "signals.json" = $signals } } | ConvertTo-Json -Compress

Write-Host "=== False-positive guardrail demo (scale-in Degraded) ===" -ForegroundColor Cyan
Write-Host "Target node: $targetNode"
Write-Host "Event id   : $eventId"
Write-Host "Signal     : availabilityState=Degraded, reasonType=Planned, summary='scaled in'"
Write-Host ""
Write-Host "Before (node is Ready, schedulable):" -ForegroundColor Yellow
kubectl get node $targetNode

Write-Host ""
Write-Host "Injecting a SCALE-IN shaped 'Degraded' signal..." -ForegroundColor Yellow
Write-Host "(the kind a VMSS scale-in produces -- NOT a hardware fault)"
kubectl patch configmap maintenance-resource-health -n $Namespace --type merge --patch $patch | Out-Null

Write-Host ""
Write-Host "Watching for ~30s. The operator should SKIP this, not cordon..." -ForegroundColor Yellow
$deadline = (Get-Date).AddSeconds(30)
do {
    Start-Sleep -Seconds 5
    $sched = kubectl get node $targetNode -o jsonpath='{.spec.unschedulable}'
    $state = kubectl get node $targetNode `
        -o jsonpath='{.metadata.annotations.maintenance\.demo/state}'
    $flag = if ($sched -eq "true") { "CORDONED (unexpected!)" } else { "still schedulable (correct)" }
    Write-Host "  node unschedulable='$sched' -> $flag ; controller state='$state'"
} until ((Get-Date) -gt $deadline)

Write-Host ""
Write-Host "Operator log -- note the 'Skipped signal' line:" -ForegroundColor Yellow
$op = Get-OperatorPod
kubectl logs $op -n $Namespace --tail 60 | Select-String -Pattern "Skipped signal|pending confirmation|Detected"

Write-Host ""
Write-Host "Store check -- the scale-in event must NOT have been persisted/acted:" -ForegroundColor Yellow
kubectl exec $op -n $Namespace -- python -c "import urllib.request,json; d=json.load(urllib.request.urlopen('http://localhost:8080/api/events')); hit=[e for e in d if e['event_id']=='$eventId']; print('  scale-in event in store:', bool(hit), '(expected: False -- guardrail rejected it before upsert)')"

Write-Host ""
Write-Host "Result:" -ForegroundColor Green
$sched = kubectl get node $targetNode -o jsonpath='{.spec.unschedulable}'
if ($sched -eq "true") {
    Write-Host "  UNEXPECTED: node was cordoned. Check operator env (REQUIRE_UNPLANNED / HARDWARE_SUMMARY_PATTERN)." -ForegroundColor Red
} else {
    Write-Host "  PASS: node stayed Ready + schedulable. A routine scale-in did NOT trigger a cordon." -ForegroundColor Green
}

Write-Host ""
Write-Host "Resetting the scenario..." -ForegroundColor Yellow
kubectl patch configmap maintenance-resource-health -n $Namespace --type merge --patch '{"data":{"signals.json":"{\"value\": []}"}}' | Out-Null

Write-Host ""
Write-Host "Done. Contrast this with a genuine fault:" -ForegroundColor Green
Write-Host "  .\demo-hardware.ps1   (reasonType=Unplanned + hardware summary -> DOES cordon)" -ForegroundColor Green
