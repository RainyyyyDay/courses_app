param([switch]$Lan)

# Starts the local PaddleOCR service used by courses_app.
# 默认只监听 127.0.0.1；加 -Lan 才监听局域网，供组员的机器调用。
$ErrorActionPreference = 'Stop'
$python = 'C:\Users\LENOVO\anaconda3\envs\ocr\Scripts\python.exe'
$base = 'http://127.0.0.1:8001'
$bind = if ($Lan) { '0.0.0.0' } else { '127.0.0.1' }

function Test-OcrHealth {
    try { return (Invoke-RestMethod -Uri "$base/health" -TimeoutSec 2).status -eq 'ok' } catch { return $false }
}

if (Test-OcrHealth) {
    if ($Lan) {
        Write-Host "OCR service is already running, but it may only listen on 127.0.0.1."
        Write-Host "Stop it first, then run:  powershell -File start.ps1 -Lan"
        Write-Host "  Get-Process python | Where-Object { `$_.Path -like '*envs\ocr*' } | Stop-Process -Force"
    } else {
        Write-Host "OCR service already running at $base"
    }
    exit 0
}

if (-not (Test-Path $python)) {
    Write-Host "Python venv not found: $python"
    exit 1
}

Start-Process -FilePath $python `
    -ArgumentList '-m', 'uvicorn', 'app:app', '--host', '127.0.0.1', '--port', '8001' `
    -WorkingDirectory $PSScriptRoot -WindowStyle Hidden

for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Seconds 1
    if (Test-OcrHealth) {
        Write-Host "OCR service started at $base"
        if ($Lan) {
            $ips = Get-NetIPAddress -AddressFamily IPv4 |
                Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
                Select-Object -ExpandProperty IPAddress
            foreach ($ip in $ips) {
                Write-Host "  LAN  -> http://${ip}:8001   (put this in the teammate's back/.env)"
            }
            Write-Host "  No auth on this port: only use it on a trusted LAN."
        }
        Write-Host ""
        Write-Host "The backend picks this up from back/.env, so just run:"
        Write-Host '  npm run dev --prefix ../back'
        exit 0
    }
}

Write-Host "OCR service did not respond in 40s. Run uvicorn in the foreground to see the error:"
Write-Host "  & '$python' -m uvicorn app:app --host 127.0.0.1 --port 8001"
exit 1
