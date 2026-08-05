[CmdletBinding()]
param(
    [string]$SubscriptionId = "00000000-0000-0000-0000-000000000000",
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
