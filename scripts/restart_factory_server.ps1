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
function Stop-GnemListener([int]$Port, [string]$ExpectedCommand) {
    $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $listener) { return }
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)"
    if (-not $process.CommandLine -or $process.CommandLine -notmatch $ExpectedCommand) {
        throw "Port $Port is used by an unexpected process. Do not stop it; ask IT."
    }
    Stop-Process -Id $listener.OwningProcess -Force
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        if (-not (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)) {
            break
        }
        Start-Sleep -Milliseconds 250
    }
    if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
        throw "GNEM did not release port $Port. Ask IT before trying again."
    }
}

Stop-GnemListener -Port 5000 -ExpectedCommand "main\.py"
Stop-GnemListener -Port 5001 -ExpectedCommand "display_server\.py"
& (Join-Path $PSScriptRoot "start_factory_server.ps1")
& (Join-Path $PSScriptRoot "start_secure_gateway.ps1")
