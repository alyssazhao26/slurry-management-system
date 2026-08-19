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

if (-not (Test-Path -LiteralPath $python)) {
    throw "Python environment is missing. Ask IT to install project requirements before starting the server."
}

$existingListener = Get-NetTCPConnection -LocalPort 5000 -State Listen -ErrorAction SilentlyContinue
if ($existingListener) {
    Write-Host "GNEM web server is already running on local port 5000."
    exit 0
}

New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null
Start-Process `
    -FilePath $python `
    -ArgumentList "main.py" `
    -WorkingDirectory $projectRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput $stdoutLog `
    -RedirectStandardError $stderrLog

for ($attempt = 0; $attempt -lt 40; $attempt++) {
    if (Get-NetTCPConnection -LocalPort 5000 -State Listen -ErrorAction SilentlyContinue) {
        Write-Host "GNEM web server started successfully."
        exit 0
    }
    Start-Sleep -Milliseconds 250
}
throw "GNEM did not start. Check $stderrLog or ask IT."
