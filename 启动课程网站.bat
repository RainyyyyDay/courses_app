@echo off
setlocal
chcp 65001 >nul
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-local.ps1"
set "launch_result=%errorlevel%"
echo.
pause
exit /b %launch_result%
