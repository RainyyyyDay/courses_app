@echo off
setlocal
chcp 65001 >nul
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0manage-local.ps1" -Action Stop
set "stop_result=%errorlevel%"
echo.
pause
exit /b %stop_result%
