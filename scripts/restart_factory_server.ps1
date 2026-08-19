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
$listener = Get-NetTCPConnection -LocalPort 5000 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1

if ($listener) {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)"
    if (-not $process.CommandLine -or $process.CommandLine -notmatch "main\.py") {
        throw "Port 5000 is used by an unexpected process. Do not stop it; ask IT."
    }
    Stop-Process -Id $listener.OwningProcess -Force
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        if (-not (Get-NetTCPConnection -LocalPort 5000 -State Listen -ErrorAction SilentlyContinue)) {
            break
        }
        Start-Sleep -Milliseconds 250
    }
    if (Get-NetTCPConnection -LocalPort 5000 -State Listen -ErrorAction SilentlyContinue) {
        throw "GNEM did not release local port 5000. Ask IT before trying again."
    }
}

& (Join-Path $PSScriptRoot "start_factory_server.ps1")
& (Join-Path $PSScriptRoot "start_secure_gateway.ps1")
