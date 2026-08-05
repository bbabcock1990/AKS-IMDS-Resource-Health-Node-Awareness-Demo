<#
.SYNOPSIS
    Deploys the Teams notification Logic App and wires it into the AKS
    maintenance controller.

.DESCRIPTION
    Two delivery modes:

    1. Built-in Teams connector (default):  -RecipientEmail <upn>
       Deploys a Teams API connection + a Logic App that posts an Adaptive Card
       as the Flow bot directly to the given user (DM). The Teams connection must
       be AUTHORIZED once in the Azure Portal (interactive OAuth) before cards
       are delivered.

    2. Outbound webhook (fallback):         -TeamsWebhookUrl <url>
       Deploys a Logic App that POSTs the card to a Teams 'Workflows' webhook.
       No OAuth required.

    In both cases the controller DaemonSet is pointed at the Logic App's HTTP
    trigger, so every maintenance state transition notifies automatically.
#>
[CmdletBinding()]
param(
    [string]$ResourceGroup = "aks-maintenance-demo-rg",
    [string]$ClusterName   = "aks-maintenance-demo",
    [string]$LogicAppName  = "aks-maint-teams-notify",
    [string]$Namespace     = "aks-maintenance-demo",
    # --- Built-in Teams connector mode (default) ---
    [string]$RecipientEmail = "",
    [string]$TeamsConnectionName = "aks-maint-teams",
    # --- Webhook fallback mode ---
    [string]$TeamsWebhookUrl = "",
    # Force webhook mode even if RecipientEmail is set.
    [switch]$UseWebhook
)

$ErrorActionPreference = "Stop"
$env:PATH = "$env:USERPROFILE\.azure-kubectl;$env:USERPROFILE\.azure-kubelogin;$env:PATH"

$useConnector = (-not $UseWebhook) -and [string]::IsNullOrWhiteSpace($TeamsWebhookUrl)

if ($useConnector) {
    # Default the DM recipient to the currently signed-in user if not supplied.
    if ([string]::IsNullOrWhiteSpace($RecipientEmail)) {
        $RecipientEmail = az account show --query user.name -o tsv
        Write-Host "No -RecipientEmail supplied; defaulting to signed-in user '$RecipientEmail'."
    }
    $templatePath = Join-Path $PSScriptRoot "notifications\teams-logicapp-connector.json"
    Write-Host "Deploying Logic App '$LogicAppName' with the built-in Teams connector"
    Write-Host "(DM to $RecipientEmail) into '$ResourceGroup'..."
    az deployment group create `
        --resource-group $ResourceGroup `
        --name "aks-maint-teams-notify" `
        --template-file $templatePath `
        --parameters logicAppName=$LogicAppName teamsConnectionName=$TeamsConnectionName recipientEmail=$RecipientEmail `
        --query "properties.provisioningState" -o tsv
} else {
    $templatePath = Join-Path $PSScriptRoot "notifications\teams-logicapp.json"
    Write-Host "Deploying Logic App '$LogicAppName' with the outbound webhook into '$ResourceGroup'..."
    az deployment group create `
        --resource-group $ResourceGroup `
        --name "aks-maint-teams-notify" `
        --template-file $templatePath `
        --parameters logicAppName=$LogicAppName teamsWebhookUrl=$TeamsWebhookUrl `
        --query "properties.provisioningState" -o tsv
}

$workflowId = az resource show `
    --resource-group $ResourceGroup `
    --resource-type "Microsoft.Logic/workflows" `
    --name $LogicAppName `
    --query id -o tsv

Write-Host "Reading trigger callback URL..."
$callbackUrl = az rest --method post `
    --url "https://management.azure.com$workflowId/triggers/manual/listCallbackUrl?api-version=2019-05-01" `
    --query value -o tsv

if (-not $callbackUrl) {
    throw "Could not read the Logic App callback URL."
}

Write-Host ""
Write-Host "Logic App trigger URL:" -ForegroundColor Cyan
Write-Host $callbackUrl
Write-Host ""

Write-Host "Wiring NOTIFICATION_WEBHOOK_URL into the controller DaemonSet..."
kubectl set env daemonset/maintenance-controller `
    -n $Namespace `
    "NOTIFICATION_WEBHOOK_URL=$callbackUrl"
kubectl rollout status daemonset/maintenance-controller -n $Namespace --timeout 3m

# The central operator also notifies on hardware-failure detection, so it needs
# the same Logic App URL. Ignore failure if the operator isn't deployed yet.
Write-Host "Wiring NOTIFICATION_WEBHOOK_URL into the maintenance operator..."
kubectl set env deployment/maintenance-operator `
    -n $Namespace `
    "NOTIFICATION_WEBHOOK_URL=$callbackUrl" 2>$null
kubectl rollout status deployment/maintenance-operator -n $Namespace --timeout 3m 2>$null

$callbackUrl | Set-Content -Path (Join-Path $PSScriptRoot "notifications\.callback-url.txt")

Write-Host ""
Write-Host "Done. The controller will POST every maintenance state transition to the Logic App." -ForegroundColor Green

if ($useConnector) {
    $connId = az resource show `
        --resource-group $ResourceGroup `
        --resource-type "Microsoft.Web/connections" `
        --name $TeamsConnectionName `
        --query id -o tsv
    Write-Host ""
    Write-Host "ACTION REQUIRED - authorize the Teams connection (one-time):" -ForegroundColor Yellow
    Write-Host "  1. Open the Azure Portal to this connection:" -ForegroundColor Yellow
    Write-Host "     https://portal.azure.com/#@/resource$connId/editApiConnectionBlade" -ForegroundColor Yellow
    Write-Host "     (or Portal -> Resource group '$ResourceGroup' -> '$TeamsConnectionName')" -ForegroundColor Yellow
    Write-Host "  2. Click 'Authorize', sign in as $RecipientEmail, then 'Save'." -ForegroundColor Yellow
    Write-Host "  3. Tell me when done and I'll send a test card." -ForegroundColor Yellow
} else {
    if (-not $TeamsWebhookUrl) {
        Write-Host "NOTE: No Teams webhook supplied; cards are recorded in run history but not delivered." -ForegroundColor Yellow
    }
}
