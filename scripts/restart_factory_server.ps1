<#!
.SYNOPSIS
Restarts the GNEM web application after an approved update.

.DESCRIPTION
Stops only a local process on port 5000 when its command line contains main.py,
then starts the standard GNEM server launcher.
#>

[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$python = Join-Path $projectRoot ".venv\Scripts\python.exe"
$serverSettings = & $python -c "from app.config import Config; print(Config.WEB_HOST); print(Config.WEB_PORT); print(Config.DISPLAY_HTTP_HOST); print(Config.DISPLAY_HTTP_PORT)"
if ($LASTEXITCODE -ne 0 -or $serverSettings.Count -ne 4) { throw "GNEM could not read its listener settings from .env." }

function Stop-GnemListener([string]$Address, [int]$Port, [string]$ExpectedCommand) {
    $listener = Get-NetTCPConnection -LocalAddress $Address -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $listener) { return }
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)"
    if (-not $process.CommandLine -or $process.CommandLine -notmatch $ExpectedCommand) {
        throw "$Address`:$Port is used by an unexpected process. Do not stop it; ask IT."
    }
    Stop-Process -Id $listener.OwningProcess -Force
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        if (-not (Get-NetTCPConnection -LocalAddress $Address -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)) {
            break
        }
        Start-Sleep -Milliseconds 250
    }
    if (Get-NetTCPConnection -LocalAddress $Address -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
        throw "GNEM did not release $Address`:$Port. Ask IT before trying again."
    }
}

Stop-GnemListener -Address $serverSettings[0] -Port ([int]$serverSettings[1]) -ExpectedCommand "main\.py"
Stop-GnemListener -Address $serverSettings[2] -Port ([int]$serverSettings[3]) -ExpectedCommand "display_server\.py"
& (Join-Path $PSScriptRoot "start_factory_server.ps1")
& (Join-Path $PSScriptRoot "start_secure_gateway.ps1")
