@echo off
setlocal
PowerShell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\restart_factory_server.ps1"
if errorlevel 1 (
    echo.
    echo GNEM could not restart. Give the displayed message and logs\web-server.stderr.log to IT.
    pause
    exit /b 1
)
echo.
echo GNEM restarted successfully. Refresh the browser with Ctrl+F5.
pause
endlocal
