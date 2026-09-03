<#
.SYNOPSIS
Stops only the GNEM web application.

.DESCRIPTION
MySQL is deliberately left running: stopping the web page must not interrupt or
alter stored records. The script verifies each process belongs to this project
before it stops it.
#>

[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot

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
