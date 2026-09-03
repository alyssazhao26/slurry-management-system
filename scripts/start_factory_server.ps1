<#!
.SYNOPSIS
Starts the GNEM web application only when it is not already listening locally.

.DESCRIPTION
This script is safe for a supervisor to run from the desktop recovery shortcut.
It writes start output to the project's logs folder and does not open a Python window.
#>

[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$python = Join-Path $projectRoot ".venv\Scripts\python.exe"
$logDirectory = Join-Path $projectRoot "logs"
$stdoutLog = Join-Path $logDirectory "web-server.stdout.log"
$stderrLog = Join-Path $logDirectory "web-server.stderr.log"
$displayStdoutLog = Join-Path $logDirectory "display-server.stdout.log"
$displayStderrLog = Join-Path $logDirectory "display-server.stderr.log"

if (-not (Test-Path -LiteralPath $python)) {
    throw "Python environment is missing. Ask IT to install project requirements before starting the server."
}

New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null

function Start-GnemProcess(
    [int]$Port,
    [string]$ScriptName,
    [string]$Component,
    [string]$OutputLog,
    [string]$ErrorLog
) {
    if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
        Write-Host "$Component is already running on port $Port."
        return
    }

    Start-Process `
        -FilePath $python `
        -ArgumentList $ScriptName `
        -WorkingDirectory $projectRoot `
        -WindowStyle Hidden `
        -RedirectStandardOutput $OutputLog `
        -RedirectStandardError $ErrorLog

    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
            Write-Host "$Component started successfully on port $Port."
            return
        }
        Start-Sleep -Milliseconds 250
    }
    throw "$Component did not start. Check $ErrorLog or ask IT."
}

Start-GnemProcess -Port 5000 -ScriptName "main.py" -Component "GNEM HTTPS application backend" -OutputLog $stdoutLog -ErrorLog $stderrLog
Start-GnemProcess -Port 5001 -ScriptName "display_server.py" -Component "GNEM read-only HTTP display" -OutputLog $displayStdoutLog -ErrorLog $displayStderrLog
