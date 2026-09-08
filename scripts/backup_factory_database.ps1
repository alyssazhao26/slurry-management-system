<#
.SYNOPSIS
Creates one consistent local GNEM MySQL backup and removes expired GNEM backups.

.DESCRIPTION
Run using the dedicated GNEM Windows service account. Credentials are read from
.env and passed to mysqldump through a short-lived protected option file, never
on the command line or in Task Scheduler arguments.
#>

[CmdletBinding()]
param([ValidateSet("slurry", "slitting")][string]$Department = "slurry")

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $projectRoot ".env"
$departmentEnvFile = Join-Path $projectRoot ".env.departments"
if (-not (Test-Path -LiteralPath $envFile)) { throw "Missing .env file." }

function Get-ProjectSetting([string]$Name, [string]$Default = "") {
    $settingLines = @(Get-Content -LiteralPath $envFile)
    if (Test-Path -LiteralPath $departmentEnvFile) { $settingLines += Get-Content -LiteralPath $departmentEnvFile }
    $match = $settingLines | Where-Object { $_ -match "^$([regex]::Escape($Name))=" } | Select-Object -Last 1
    if (-not $match) { return $Default }
    return $match.Substring($Name.Length + 1).Trim().Trim('"').Trim("'").Trim()
}

$backupDirectory = Get-ProjectSetting "BACKUP_DIRECTORY" "C:\GNEM_Backups"
$retentionDays = [int](Get-ProjectSetting "BACKUP_RETENTION_DAYS" "30")
$dbHost = Get-ProjectSetting "DB_HOST" "127.0.0.1"
$dbPort = Get-ProjectSetting "DB_PORT" "3306"
$dbName = Get-ProjectSetting "DB_NAME" "slurry_management"
$importSchema = Get-ProjectSetting "IMPORT_SCHEMA" "system_import"
if ($Department -eq "slitting") {
    $dbName = Get-ProjectSetting "SLITTING_DB_NAME" "slitting_management"
    $importSchema = Get-ProjectSetting "SLITTING_IMPORT_SCHEMA" "slitting_system_import"
}
$dbUser = Get-ProjectSetting "DB_BACKUP_USER"
$dbPassword = Get-ProjectSetting "DB_BACKUP_PASSWORD"
if (-not $dbUser -or -not $dbPassword) {
    # Pilot fallback: use the app account until a backup-only account exists.
    $dbUser = Get-ProjectSetting "DB_USER"
    $dbPassword = Get-ProjectSetting "DB_PASSWORD"
}
if ($Department -eq "slitting") {
    $slittingBackupUser = Get-ProjectSetting "SLITTING_DB_BACKUP_USER"
    $slittingBackupPassword = Get-ProjectSetting "SLITTING_DB_BACKUP_PASSWORD"
    if ($slittingBackupUser -and $slittingBackupPassword) {
        $dbUser = $slittingBackupUser
        $dbPassword = $slittingBackupPassword
    }
}
if (-not $dbUser -or -not $dbPassword) { throw "Set DB_USER/DB_PASSWORD or DB_BACKUP_USER/DB_BACKUP_PASSWORD in .env." }
$resolvedBackupDirectory = [IO.Path]::GetFullPath($backupDirectory).TrimEnd('\\')
$resolvedProjectRoot = [IO.Path]::GetFullPath($projectRoot).TrimEnd('\\')
if ($resolvedBackupDirectory.StartsWith($resolvedProjectRoot, [StringComparison]::OrdinalIgnoreCase)) { throw "Use a dedicated backup directory outside the project folder." }

$configuredDumpPath = Get-ProjectSetting "MYSQLDUMP_PATH" $env:MYSQLDUMP_PATH
if ($configuredDumpPath) {
    if (-not (Test-Path -LiteralPath $configuredDumpPath -PathType Leaf)) {
        throw "MYSQLDUMP_PATH does not point to mysqldump.exe."
    }
    $dumpCommand = $configuredDumpPath
} else {
    $dumpCommand = (Get-Command mysqldump.exe -ErrorAction Stop).Source
}
New-Item -ItemType Directory -Force -Path $backupDirectory | Out-Null
$stamp = Get-Date -Format "yyyy-MM-dd_HHmmss"
$backupFile = Join-Path $backupDirectory "gnem_backup_${Department}_$stamp.sql"
$optionFile = Join-Path $env:TEMP ("gnem-mysql-" + [guid]::NewGuid().ToString("N") + ".cnf")

try {
    [string]::Join([Environment]::NewLine, @("[client]", "user=$dbUser", "password=$dbPassword", "host=$dbHost", "port=$dbPort")) | Set-Content -LiteralPath $optionFile -Encoding ascii -NoNewline
    & $dumpCommand "--defaults-extra-file=$optionFile" "--single-transaction" "--routines" "--events" "--databases" $dbName $importSchema "--result-file=$backupFile"
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $backupFile) -or (Get-Item -LiteralPath $backupFile).Length -eq 0) {
        throw "mysqldump failed; no valid backup was accepted."
    }
    Get-ChildItem -LiteralPath $backupDirectory -Filter "gnem_backup_${Department}_*.sql" -File |
        Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$retentionDays) } |
        Remove-Item -Force
    Write-Host "Backup completed: $backupFile"
}
finally {
    Remove-Item -LiteralPath $optionFile -Force -ErrorAction SilentlyContinue
}
