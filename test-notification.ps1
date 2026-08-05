<#
.SYNOPSIS
    Sends a sample AKS maintenance event to the notification Logic App, exactly
    as the controller would, so you can validate the pipeline without running
    the full drain scenario.
#>
[CmdletBinding()]
param(
    [string]$ResourceGroup = "aks-maintenance-demo-rg",
    [string]$LogicAppName  = "aks-maint-teams-notify",
    [string]$State         = "Detected",
    [string]$EventType     = "Redeploy",
    [string]$Node          = "aks-system-16042659-vmss000000"
)

$ErrorActionPreference = "Stop"

$callbackFile = Join-Path $PSScriptRoot "notifications\.callback-url.txt"
if (Test-Path $callbackFile) {
    $callbackUrl = (Get-Content $callbackFile -Raw).Trim()
} else {
    $workflowId = az resource show `
        --resource-group $ResourceGroup `
        --resource-type "Microsoft.Logic/workflows" `
        --name $LogicAppName `
        --query id -o tsv
    $callbackUrl = az rest --method post `
        --url "https://management.azure.com$workflowId/triggers/manual/listCallbackUrl?api-version=2019-05-01" `
        --query value -o tsv
}

if (-not $callbackUrl) {
    throw "Could not resolve the Logic App callback URL. Run .\deploy-notifications.ps1 first."
}

$payload = @{
    node      = $Node
    eventId   = "test-" + [guid]::NewGuid().ToString("N")
    eventType = $EventType
    source    = "DemoSimulator"
    state     = $State
    detail    = "Sample notification sent by test-notification.ps1"
} | ConvertTo-Json -Compress

Write-Host "POSTing sample '$State' event to the Logic App..."
$response = Invoke-RestMethod -Method Post -Uri $callbackUrl -ContentType "application/json" -Body $payload
Write-Host ""
Write-Host "Logic App responded:" -ForegroundColor Green
$response | ConvertTo-Json -Depth 8
Write-Host ""
Write-Host "Check run history:  Azure Portal -> Logic App '$LogicAppName' -> Runs history"
