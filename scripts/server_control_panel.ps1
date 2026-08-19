<# Opens the supervisor's local GNEM Start / Restart / Stop control panel. #>
[CmdletBinding()]
param()

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$projectRoot = Split-Path -Parent $PSScriptRoot
$form = New-Object System.Windows.Forms.Form
$form.Text = "GNEM Server Control Panel"
$form.Size = New-Object System.Drawing.Size(520, 270)
$form.StartPosition = "CenterScreen"
$form.FormBorderStyle = "FixedDialog"
$form.MaximizeBox = $false
$form.BackColor = [System.Drawing.Color]::FromArgb(6, 35, 63)

$title = New-Object System.Windows.Forms.Label
$title.Text = "GNEM Slurry Production Tracker"
$title.ForeColor = [System.Drawing.Color]::White
$title.Font = New-Object System.Drawing.Font("Segoe UI", 16, [System.Drawing.FontStyle]::Bold)
$title.AutoSize = $true
$title.Location = New-Object System.Drawing.Point(24, 22)
$form.Controls.Add($title)

$info = New-Object System.Windows.Forms.Label
$info.Text = "Control web access only. MySQL and saved records are not stopped or deleted."
$info.ForeColor = [System.Drawing.Color]::LightSteelBlue
$info.AutoSize = $true
$info.Location = New-Object System.Drawing.Point(26, 58)
$form.Controls.Add($info)

$status = New-Object System.Windows.Forms.Label
$status.Text = "Ready."
$status.ForeColor = [System.Drawing.Color]::White
$status.AutoSize = $false
$status.Size = New-Object System.Drawing.Size(460, 44)
$status.Location = New-Object System.Drawing.Point(26, 185)
$form.Controls.Add($status)

function Add-ControlButton([string]$Text, [int]$Left, [scriptblock]$Action) {
    $button = New-Object System.Windows.Forms.Button
    $button.Text = $Text
    $button.Size = New-Object System.Drawing.Size(140, 54)
    $button.Location = New-Object System.Drawing.Point($Left, 108)
    $button.Font = New-Object System.Drawing.Font("Segoe UI", 11, [System.Drawing.FontStyle]::Bold)
    $button.BackColor = [System.Drawing.Color]::FromArgb(55, 120, 174)
    $button.ForeColor = [System.Drawing.Color]::White
    $button.FlatStyle = "Flat"
    $clickHandler = {
        $status.Text = "Working..."
        $form.Refresh()
        try {
            $Action.Invoke()
            $status.Text = "Completed."
        } catch {
            $status.Text = "Could not complete safely: $($_.Exception.Message)"
        }
    }.GetNewClosure()
    $button.Add_Click($clickHandler)
    $form.Controls.Add($button)
}

Add-ControlButton "Start / 启动" 26 {
    & (Join-Path $PSScriptRoot "start_factory_server.ps1")
    & (Join-Path $PSScriptRoot "start_secure_gateway.ps1")
}
Add-ControlButton "Restart / 重启" 184 { & (Join-Path $PSScriptRoot "restart_factory_server.ps1") }
Add-ControlButton "Stop / 停止" 342 { & (Join-Path $PSScriptRoot "stop_factory_server.ps1") }

[void]$form.ShowDialog()
