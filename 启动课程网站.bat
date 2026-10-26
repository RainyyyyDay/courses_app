@echo off
setlocal
chcp 65001 >nul
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0manage-local.ps1" -Action Menu
set "launch_result=%errorlevel%"
if not "%launch_result%"=="0" pause
exit /b %launch_result%
