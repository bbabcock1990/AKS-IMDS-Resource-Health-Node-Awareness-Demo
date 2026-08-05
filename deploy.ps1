[CmdletBinding()]
param(
    [string]$SubscriptionId = (az account show --query id -o tsv),
    [string]$Location = "westus2",
    [string]$ResourceGroup = "aks-maintenance-demo-rg",
    [string]$ClusterName = "aks-maintenance-demo",
    [string]$VmSize = "Standard_D2als_v7",
    # Optional: paste a Teams 'Workflows' webhook URL to deliver real cards to a
    # channel. Leave empty to wire the pipeline without live Teams delivery.
    [string]$TeamsWebhookUrl = "",
    # Optional: Teams DM recipient for the notification card. Leave empty to
    # default to the currently signed-in user (az account show user.name).
    [string]$RecipientEmail = ""
)

$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $true
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$env:PATH = "$env:USERPROFILE\.azure-kubectl;$env:USERPROFILE\.azure-kubelogin;$env:PATH"

if (-not (Get-Command kubectl -ErrorAction SilentlyContinue)) {
    Write-Host "Installing kubectl and kubelogin..."
    az aks install-cli
    $env:PATH = "$env:USERPROFILE\.azure-kubectl;$env:USERPROFILE\.azure-kubelogin;$env:PATH"
}

az account set --subscription $SubscriptionId

Write-Host "Creating resource group $ResourceGroup in $Location..."
az group create `
    --name $ResourceGroup `
    --location $Location `
    --tags purpose=aks-maintenance-demo owner=demo `
    --output none

$existing = az aks list `
    --resource-group $ResourceGroup `
    --query "[?name=='$ClusterName'].name | [0]" `
    --output tsv

if (-not $existing) {
    Write-Host "Creating a two-node AKS Free tier cluster..."
    az aks create `
        --resource-group $ResourceGroup `
        --name $ClusterName `
        --location $Location `
        --tier free `
        --node-count 2 `
        --node-vm-size $VmSize `
        --nodepool-name system `
        --network-plugin azure `
        --network-plugin-mode overlay `
        --generate-ssh-keys `
        --enable-managed-identity `
        --tags purpose=aks-maintenance-demo owner=demo `
        --output none
}

Write-Host "Loading cluster credentials..."
az aks get-credentials `
    --resource-group $ResourceGroup `
    --name $ClusterName `
    --overwrite-existing `
    --output none

kubectl apply -f (Join-Path $Root "manifests\00-platform.yaml")
$controllerFile = "controller.py=$(Join-Path $Root 'controller.py')"
kubectl create configmap maintenance-controller-code `
    --namespace aks-maintenance-demo `
    --from-file $controllerFile `
    --dry-run=client `
    --output yaml |
    kubectl apply -f -
$operatorFile = "maintenance_operator.py=$(Join-Path $Root 'maintenance_operator.py')"
kubectl create configmap maintenance-operator-code `
    --namespace aks-maintenance-demo `
    --from-file $operatorFile `
    --dry-run=client `
    --output yaml |
    kubectl apply -f -
kubectl apply -f (Join-Path $Root "manifests\10-controller.yaml")
kubectl apply -f (Join-Path $Root "manifests\20-workload.yaml")
kubectl apply -f (Join-Path $Root "manifests\30-operator.yaml")

kubectl rollout status daemonset/maintenance-controller `
    --namespace aks-maintenance-demo `
    --timeout 10m
kubectl rollout status deployment/maintenance-demo-app `
    --namespace aks-maintenance-demo `
    --timeout 5m
kubectl rollout status deployment/maintenance-operator `
    --namespace aks-maintenance-demo `
    --timeout 10m

Write-Host ""
Write-Host "Deploying the Teams notification pipeline (Logic App) and wiring it"
Write-Host "into the controller so maintenance events notify automatically..."
& (Join-Path $Root "deploy-notifications.ps1") `
    -ResourceGroup $ResourceGroup `
    -ClusterName $ClusterName `
    -TeamsWebhookUrl $TeamsWebhookUrl `
    -RecipientEmail $RecipientEmail

Write-Host ""
Write-Host "Deployment complete."
kubectl get nodes -o wide
kubectl get pods -n aks-maintenance-demo -o wide
Write-Host ""
Write-Host "Run .\demo.ps1 to execute the safe simulated maintenance scenario."
Write-Host "Maintenance events will automatically notify via the Logic App."
