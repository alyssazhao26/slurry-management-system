<#
.SYNOPSIS
Archives GNEM web logs, then safely restarts only the GNEM web server.

.DESCRIPTION
Schedule weekly outside the busiest shift. It causes a brief web-app restart
while MySQL remains available. Old archives are kept for 12 weeks.
#>

[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$logs = Join-Path $projectRoot "logs"
$archive = Join-Path $logs "archive"
$listener = Get-NetTCPConnection -LocalPort 5000 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener) {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)"
    if (-not $process.CommandLine -or $process.CommandLine -notmatch "main\.py") { throw "Port 5000 belongs to another process; logs were not rotated." }
    Stop-Process -Id $listener.OwningProcess -Force
    Start-Sleep -Seconds 2
}
New-Item -ItemType Directory -Force -Path $archive | Out-Null
$stamp = Get-Date -Format "yyyy-MM-dd_HHmmss"
Get-ChildItem -LiteralPath $logs -Filter "web-server.*.log" -File -ErrorAction SilentlyContinue |
    ForEach-Object { Move-Item -LiteralPath $_.FullName -Destination (Join-Path $archive ("$($_.BaseName)_$stamp$($_.Extension)")) }
Get-ChildItem -LiteralPath $archive -Filter "web-server.*_*.log" -File -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-84) } |
    Remove-Item -Force
& (Join-Path $PSScriptRoot "start_factory_server.ps1")
Write-Host "GNEM logs archived and web server restarted."
