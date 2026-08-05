[CmdletBinding()]
param(
    [string]$SubscriptionId = (az account show --query id -o tsv),
    [string]$ResourceGroup = "aks-maintenance-demo-rg"
)

$ErrorActionPreference = "Stop"

az account set --subscription $SubscriptionId
Write-Host "Deleting resource group $ResourceGroup..."
az group delete `
    --name $ResourceGroup `
    --yes `
    --no-wait
Write-Host "Deletion started. The local demo artifacts were retained."
