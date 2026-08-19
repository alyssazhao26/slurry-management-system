@echo off
setlocal
PowerShell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop_factory_server.ps1"
if errorlevel 1 (
    echo.
    echo GNEM could not be stopped safely. Give the displayed message to IT.
    pause
    exit /b 1
)
echo.
echo GNEM web access is stopped. MySQL remains running and stored records are unchanged.
pause
endlocal
