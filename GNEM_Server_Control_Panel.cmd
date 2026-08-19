@echo off
start "GNEM Server Control Panel" PowerShell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0scripts\server_control_panel.ps1"
