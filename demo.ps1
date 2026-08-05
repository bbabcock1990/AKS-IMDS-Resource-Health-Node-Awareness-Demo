[CmdletBinding()]
param(
    [string]$Namespace = "aks-maintenance-demo"
)

$ErrorActionPreference = "Stop"
$env:PATH = "$env:USERPROFILE\.azure-kubectl;$env:USERPROFILE\.azure-kubelogin;$env:PATH"

$workload = kubectl get pods `
    -n $Namespace `
    -l app=maintenance-demo-app `
    -o json |
    ConvertFrom-Json
$targetNode = $workload.items |
    Group-Object -Property { $_.spec.nodeName } |
    Sort-Object Count -Descending |
    Select-Object -First 1 -ExpandProperty Name

if (-not $targetNode) {
    throw "No AKS nodes were found."
}

$event = @{
    eventId = "demo-" + [guid]::NewGuid().ToString("N")
    targetNode = $targetNode
    eventType = "Redeploy"
    eventStatus = "Scheduled"
    source = "DemoSimulator"
    notBefore = (Get-Date).ToUniversalTime().AddMinutes(10).ToString("o")
    description = "Simulated Azure host redeployment for the AKS maintenance demonstration."
} | ConvertTo-Json -Compress

$patch = @{
    data = @{
        "event.json" = $event
    }
} | ConvertTo-Json -Compress

Write-Host "Before the event:"
kubectl get nodes
kubectl get pods -n $Namespace -o wide

Write-Host ""
Write-Host "Injecting a simulated Redeploy event for $targetNode..."
kubectl patch configmap maintenance-demo-events `
    -n $Namespace `
    --type merge `
    --patch $patch | Out-Null

$deadline = (Get-Date).AddMinutes(7)
do {
    Start-Sleep -Seconds 3
    $state = kubectl get node $targetNode `
        -o jsonpath='{.metadata.annotations.maintenance\.demo/state}'
    Write-Host "Controller state: $state"
} until ($state -eq "SimulatedComplete" -or (Get-Date) -gt $deadline)

if ($state -ne "SimulatedComplete") {
    throw "The simulated drain did not complete. Review controller logs."
}

Write-Host ""
Write-Host "After cordon and workload eviction:"
kubectl get nodes
kubectl get pods -n $Namespace -o wide
$controllerPod = kubectl get pods `
    -n $Namespace `
    -l app=maintenance-controller `
    --field-selector "spec.nodeName=$targetNode" `
    -o jsonpath='{.items[0].metadata.name}'
kubectl logs $controllerPod `
    -n $Namespace `
    --since 1m `
    --tail 50 |
    Select-String -Pattern "Controller started|MAINTENANCE_EVENT"

Write-Host ""
Write-Host "Simulating maintenance completion and returning the node to service..."
kubectl patch configmap maintenance-demo-events `
    -n $Namespace `
    --type merge `
    --patch '{"data":{"event.json":""}}' | Out-Null
kubectl uncordon $targetNode
kubectl annotate node $targetNode `
    maintenance.demo/event-id- `
    maintenance.demo/event-type- `
    maintenance.demo/event-source- `
    maintenance.demo/state- `
    maintenance.demo/updated-at- `
    2>$null | Out-Null

kubectl rollout restart deployment/maintenance-demo-app `
    -n $Namespace | Out-Null
kubectl rollout status deployment/maintenance-demo-app `
    -n $Namespace `
    --timeout 3m

Write-Host ""
Write-Host "Demo completed. Final state:"
kubectl get nodes
kubectl get pods -n $Namespace -o wide
