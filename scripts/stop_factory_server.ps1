<#
.SYNOPSIS
Stops the GNEM web application, read-only display server, and HTTPS gateway.

.DESCRIPTION
MySQL is deliberately left running: stopping the web page must not interrupt or
alter stored records. The script verifies each process belongs to this project
before it stops it.
#>

[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$caddyPath = Join-Path $projectRoot "deployment\caddy\caddy.exe"
$python = Join-Path $projectRoot ".venv\Scripts\python.exe"
$serverSettings = & $python -c "from app.config import Config; print(Config.WEB_HOST); print(Config.WEB_PORT); print(Config.DISPLAY_HTTP_HOST); print(Config.DISPLAY_HTTP_PORT)"
if ($LASTEXITCODE -ne 0 -or $serverSettings.Count -ne 4) { throw "GNEM could not read its listener settings from .env." }

function Stop-GnemListener([string]$Address, [int]$Port, [string]$ExpectedCommand, [string]$Component) {
    $listener = Get-NetTCPConnection -LocalAddress $Address -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $listener) {
        Write-Host "$Component is not running."
        return
    }

    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)"
    if (-not $process.CommandLine -or $process.CommandLine -notmatch $ExpectedCommand) {
        throw "$Address`:$Port is used by an unexpected process. It was not stopped; ask IT."
    }

    Stop-Process -Id $listener.OwningProcess -Force
    Write-Host "$Component stopped."
}

Stop-GnemListener -Address $serverSettings[0] -Port ([int]$serverSettings[1]) -ExpectedCommand "main\.py" -Component "GNEM web server"
Stop-GnemListener -Address $serverSettings[2] -Port ([int]$serverSettings[3]) -ExpectedCommand "display_server\.py" -Component "GNEM HTTP display server"

if (Get-NetTCPConnection -LocalPort 443 -State Listen -ErrorAction SilentlyContinue) {
    $gateway = Get-NetTCPConnection -LocalPort 443 -State Listen | Select-Object -First 1
    $gatewayProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $($gateway.OwningProcess)"
    if ($gatewayProcess.ExecutablePath -and $gatewayProcess.ExecutablePath -ieq $caddyPath) {
        Stop-Process -Id $gateway.OwningProcess -Force
        Write-Host "GNEM HTTPS gateway stopped."
    } else {
        Write-Host "HTTPS gateway on port 443 belongs to another process and was not stopped."
    }
}
