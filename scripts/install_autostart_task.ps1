<#!
.SYNOPSIS
Installs a Windows startup task for the complete GNEM application stack.

.DESCRIPTION
Run once as a Windows administrator. Use a dedicated non-administrator Windows
service account, not an employee account. The task starts both the local web
application and the Caddy HTTPS gateway. Windows asks for that account password;
the password is stored by Task Scheduler, not in this project.
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$TaskUser,

    [string]$TaskName = "GNEM Slurry Tracker"
)

$ErrorActionPreference = "Stop"
$credential = Get-Credential -UserName $TaskUser -Message "Enter the password for the GNEM service account"
$startScript = Join-Path $PSScriptRoot "restart_factory_server.ps1"

if (-not (Test-Path -LiteralPath $startScript)) {
    throw "Start script is missing: $startScript"
}

$action = New-ScheduledTaskAction `
    -Execute "PowerShell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$startScript`""
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -User $credential.UserName `
    -Password $credential.GetNetworkCredential().Password `
    -RunLevel Limited `
    -Force | Out-Null

Write-Host "Installed '$TaskName'. It will start the GNEM web app and HTTPS gateway after every Windows reboot."
