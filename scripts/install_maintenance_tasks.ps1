<#
.SYNOPSIS
Installs GNEM daily backup and weekly log-maintenance tasks.

.DESCRIPTION
Run once as a Windows administrator using the same dedicated, non-administrator
service account used for the GNEM startup task. Backups run daily at 01:15;
logs archive and the web app restarts weekly on Sunday at 02:15.
#>

[CmdletBinding()]
param([Parameter(Mandatory)][string]$TaskUser)

$ErrorActionPreference = "Stop"
$credential = Get-Credential -UserName $TaskUser -Message "Enter the GNEM service-account password"
$backupScript = Join-Path $PSScriptRoot "backup_factory_database.ps1"
$rotateScript = Join-Path $PSScriptRoot "rotate_factory_logs.ps1"
foreach ($script in @($backupScript, $rotateScript)) { if (-not (Test-Path -LiteralPath $script)) { throw "Missing script: $script" } }

function Register-GnemTask([string]$Name, [string]$Script, $Trigger) {
    $action = New-ScheduledTaskAction -Execute "PowerShell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$Script`""
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 2)
    Register-ScheduledTask -TaskName $Name -Action $action -Trigger $Trigger -Settings $settings -User $credential.UserName -Password $credential.GetNetworkCredential().Password -RunLevel Limited -Force | Out-Null
}

Register-GnemTask "GNEM Daily MySQL Backup" $backupScript (New-ScheduledTaskTrigger -Daily -At 1:15am)
Register-GnemTask "GNEM Weekly Log Maintenance" $rotateScript (New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At 2:15am)
Write-Host "Installed GNEM daily backup and weekly log-maintenance tasks."
