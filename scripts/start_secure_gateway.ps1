<# Starts the internal HTTPS gateway for GNEM. #>
[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$caddy = Join-Path $projectRoot "deployment\caddy\caddy.exe"
$config = Join-Path $projectRoot "deployment\caddy\Caddyfile"
$logs = Join-Path $projectRoot "logs"

if (-not (Test-Path -LiteralPath $caddy)) { throw "Caddy is not installed." }
if (Get-NetTCPConnection -LocalPort 443 -State Listen -ErrorAction SilentlyContinue) {
    Write-Host "HTTPS gateway already listens on port 443."
    exit 0
}

New-Item -ItemType Directory -Force -Path $logs | Out-Null
Start-Process -FilePath $caddy -ArgumentList "run --config `"$config`" --adapter caddyfile" `
    -WorkingDirectory $projectRoot -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $logs "caddy.stdout.log") `
    -RedirectStandardError (Join-Path $logs "caddy.stderr.log")
for ($attempt = 0; $attempt -lt 40; $attempt++) {
    if (Get-NetTCPConnection -LocalPort 443 -State Listen -ErrorAction SilentlyContinue) {
        Write-Host "GNEM HTTPS gateway started successfully."
        exit 0
    }
    Start-Sleep -Milliseconds 250
}
throw "HTTPS gateway did not start. Check logs\caddy.stderr.log."
