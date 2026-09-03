@echo off
setlocal
PowerShell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start_factory_server.ps1"
if errorlevel 1 (
    echo.
    echo GNEM could not start. Please give the displayed message and logs\web-server.stderr.log to IT.
    pause
    exit /b 1
)
PowerShell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start_secure_gateway.ps1"
if errorlevel 1 (
    echo.
    echo Secure HTTPS gateway could not start. Give the displayed message and logs\caddy.stderr.log to IT.
    pause
    exit /b 1
)
echo.
echo GNEM Slurry Tracker is running or was already running.
echo Open https://slurry-management.local on approved employee and manager computers.
echo Open http://172.23.19.139:5000/display on the read-only factory display.
pause
endlocal
