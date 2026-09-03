@echo off
setlocal
PowerShell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start_factory_server.ps1"
if errorlevel 1 (
    echo.
    echo GNEM could not start. Please give the displayed message and logs\web-server.stderr.log to IT.
    pause
    exit /b 1
)
echo.
echo GNEM Slurry Tracker is running or was already running.
echo Open http://SERVER-IP:5000/display on the factory display.
pause
endlocal
