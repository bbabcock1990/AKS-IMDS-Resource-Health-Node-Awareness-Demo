$ErrorActionPreference = "Stop"
$env:PATH = "$env:USERPROFILE\.azure-kubectl;$env:USERPROFILE\.azure-kubelogin;$env:PATH"

kubectl get nodes `
    -o custom-columns='NODE:.metadata.name,READY:.status.conditions[-1].status,SCHEDULING-DISABLED:.spec.unschedulable,EVENT:.metadata.annotations.maintenance\.demo/event-type,STATE:.metadata.annotations.maintenance\.demo/state'

Write-Host ""
kubectl get pods -n aks-maintenance-demo -o wide

Write-Host ""
kubectl logs `
    -l app=maintenance-controller `
    -n aks-maintenance-demo `
    --since 10m `
    --tail 100 `
    --prefix |
    Select-String -Pattern "Controller started|MAINTENANCE_EVENT|WARNING|ERROR"
