# Starts the local PaddleOCR service used by courses_app.
$ErrorActionPreference = 'Stop'
$python = 'C:\Users\LENOVO\anaconda3\envs\ocr\Scripts\python.exe'
$base = 'http://127.0.0.1:8001'

function Test-OcrHealth {
    try { return (Invoke-RestMethod -Uri "$base/health" -TimeoutSec 2).status -eq 'ok' } catch { return $false }
}

if (Test-OcrHealth) {
    Write-Host "OCR service already running at $base"
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
        Write-Host ""
        Write-Host "The backend picks this up from back/.env, so just run:"
        Write-Host '  npm run dev --prefix ../back'
        exit 0
    }
}

Write-Host "OCR service did not respond in 40s. Run uvicorn in the foreground to see the error:"
Write-Host "  & '$python' -m uvicorn app:app --host 127.0.0.1 --port 8001"
exit 1
