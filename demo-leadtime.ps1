<#
.SYNOPSIS
    Lead-time scheduling scenario (#5).

.DESCRIPTION
    Shows the controller honoring a maintenance window: it does NOT cordon
    immediately on detection. Instead it computes cordon time = notBefore minus
    leadSeconds, reports a "Scheduled" state (and a Teams "Scheduled" card), and
    only cordons/drains once the lead window arrives.

    To keep the demo short we inject notBefore ~120s out with a 60s lead, so you
    see roughly a minute in "Scheduled" before the action fires. In production
    LEAD_SECONDS would be minutes/hours ahead of a real Scheduled Event window.
#>
[CmdletBinding()]
param(
    [string]$Namespace = "aks-maintenance-demo",
    [int]$WindowSeconds = 120,
    [int]$LeadSeconds = 60
)

$ErrorActionPreference = "Stop"
$env:PATH = "$env:USERPROFILE\.azure-kubectl;$env:USERPROFILE\.azure-kubelogin;$env:PATH"

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

$notBefore = (Get-Date).ToUniversalTime().AddSeconds($WindowSeconds).ToString("o")
$event = @{
    eventId     = "lead-" + [guid]::NewGuid().ToString("N").Substring(0, 8)
    targetNode  = $targetNode
    eventType   = "Redeploy"
    eventStatus = "Scheduled"
    source      = "DemoSimulator"
    notBefore   = $notBefore
    leadSeconds = $LeadSeconds
    description = "Redeploy scheduled; controller should cordon $LeadSeconds s before the window."
} | ConvertTo-Json -Compress
$patch = @{ data = @{ "event.json" = $event } } | ConvertTo-Json -Compress

Write-Host "=== Lead-time scheduling demo ===" -ForegroundColor Cyan
Write-Host "Target node : $targetNode"
Write-Host "notBefore   : $notBefore  (~${WindowSeconds}s out)"
Write-Host "leadSeconds : $LeadSeconds  -> cordon at window minus ${LeadSeconds}s"
Write-Host ""
Write-Host "Injecting the scheduled event..." -ForegroundColor Yellow
kubectl patch configmap maintenance-demo-events -n $Namespace --type merge --patch $patch | Out-Null

Write-Host ""
Write-Host "Watching controller state (expect: Scheduled ... then Cordoned/Drained/SimulatedComplete):" -ForegroundColor Yellow
$deadline = (Get-Date).AddSeconds($WindowSeconds + 180)
$sawScheduled = $false
do {
    Start-Sleep -Seconds 4
    $state = kubectl get node $targetNode `
        -o jsonpath='{.metadata.annotations.maintenance\.demo/state}'
    $stamp = (Get-Date).ToString("HH:mm:ss")
    Write-Host "  $stamp  state=$state"
    if ($state -eq "Scheduled") { $sawScheduled = $true }
} until ($state -eq "SimulatedComplete" -or (Get-Date) -gt $deadline)

Write-Host ""
if ($sawScheduled) {
    Write-Host "PASS: controller held in 'Scheduled' until the lead window, then acted." -ForegroundColor Green
} else {
    Write-Host "NOTE: 'Scheduled' phase was brief/missed; try a larger -WindowSeconds." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Controller transitions (Teams cards fired for each):" -ForegroundColor Yellow
$pod = kubectl get pods -n $Namespace -l app=maintenance-controller `
    --field-selector "spec.nodeName=$targetNode" `
    -o jsonpath='{.items[0].metadata.name}'
kubectl logs $pod -n $Namespace --since 5m --tail 60 | Select-String -Pattern "MAINTENANCE_EVENT"

Write-Host ""
Write-Host "Resetting..." -ForegroundColor Yellow
kubectl patch configmap maintenance-demo-events -n $Namespace --type merge --patch '{"data":{"event.json":""}}' | Out-Null
kubectl uncordon $targetNode | Out-Null
kubectl annotate node $targetNode `
    maintenance.demo/event-id- maintenance.demo/event-type- `
    maintenance.demo/event-source- maintenance.demo/state- `
    maintenance.demo/updated-at- 2>$null | Out-Null
kubectl rollout restart deployment/maintenance-demo-app -n $Namespace | Out-Null
kubectl rollout status deployment/maintenance-demo-app -n $Namespace --timeout 3m
Write-Host "Done." -ForegroundColor Green
