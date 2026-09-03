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
$serverSettings = & $python -c "from app.config import Config; print(Config.WEB_HOST); print(Config.WEB_PORT); print(Config.DISPLAY_HTTP_HOST); print(Config.DISPLAY_HTTP_PORT)"
if ($LASTEXITCODE -ne 0 -or $serverSettings.Count -ne 4) {
    throw "GNEM could not read its listener settings from .env."
}
$webHost = $serverSettings[0]
$webPort = [int]$serverSettings[1]
$displayHost = $serverSettings[2]
$displayPort = [int]$serverSettings[3]

function Start-GnemProcess(
    [string]$Address,
    [int]$Port,
    [string]$ScriptName,
    [string]$ExpectedCommand,
    [string]$Component,
    [string]$OutputLog,
    [string]$ErrorLog
) {
    $listener = Get-NetTCPConnection -LocalAddress $Address -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($listener) {
        $process = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)"
        if (-not $process.CommandLine -or $process.CommandLine -notmatch $ExpectedCommand) {
            throw "$Address`:$Port is used by an unexpected process. Do not stop it; ask IT."
        }
        Write-Host "$Component is already running on $Address`:$Port."
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
        if (Get-NetTCPConnection -LocalAddress $Address -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
            Write-Host "$Component started successfully on $Address`:$Port."
            return
        }
        Start-Sleep -Milliseconds 250
    }
    throw "$Component did not start. Check $ErrorLog or ask IT."
}

Start-GnemProcess -Address $webHost -Port $webPort -ScriptName "main.py" -ExpectedCommand "main\.py" -Component "GNEM HTTPS application backend" -OutputLog $stdoutLog -ErrorLog $stderrLog
Start-GnemProcess -Address $displayHost -Port $displayPort -ScriptName "display_server.py" -ExpectedCommand "display_server\.py" -Component "GNEM read-only HTTP display" -OutputLog $displayStdoutLog -ErrorLog $displayStderrLog
