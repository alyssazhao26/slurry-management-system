<#
.SYNOPSIS
Stops only the GNEM web application and its local HTTPS gateway.

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

function Stop-GnemListener([int]$Port, [string]$ExpectedCommand, [string]$Component) {
    $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $listener) {
        Write-Host "$Component is not running."
        return
    }

    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)"
    if (-not $process.CommandLine -or $process.CommandLine -notmatch $ExpectedCommand) {
        throw "Port $Port is used by an unexpected process. It was not stopped; ask IT."
    }

    Stop-Process -Id $listener.OwningProcess -Force
    Write-Host "$Component stopped."
}

Stop-GnemListener -Port 5000 -ExpectedCommand "main\.py" -Component "GNEM web server"

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
