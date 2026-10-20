[CmdletBinding()]
param([switch]$Lan, [switch]$CheckOnly)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$base = 'http://127.0.0.1:8001'
$bind = if ($Lan) { '0.0.0.0' } else { '127.0.0.1' }

function Test-OcrHealth {
    try {
        $health = Invoke-RestMethod -Uri "$base/health" -TimeoutSec 2
        return ($health.status -eq 'ok' -and $health.provider -eq 'paddleocr')
    } catch { return $false }
}

function Get-OcrPython {
    # Prefer this project's environment; never reuse a teammate's absolute path.
    $local = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'
    $candidates = @()
    if (Test-Path -LiteralPath $local -PathType Leaf) { $candidates += @{File=$local; Prefix=@()} }
    $launcher = Get-Command 'py.exe' -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($launcher) { $candidates += @{File=$launcher.Source; Prefix=@('-3')} }
    $command = Get-Command 'python.exe' -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($command) { $candidates += @{File=$command.Source; Prefix=@()} }
    foreach ($candidate in $candidates) {
        try {
            $prefix = @($candidate.Prefix)
            $resolved = @(& $candidate.File @prefix -I -B -c 'import sys; print(sys.executable)' 2>$null)
            if ($LASTEXITCODE -eq 0 -and $resolved.Count -eq 1 -and (Test-Path -LiteralPath ([string]$resolved[0]) -PathType Leaf)) { return [string]$resolved[0] }
        } catch { }
    }
    throw '未找到可运行的 Python 3。请准备 ocr-service\.venv，或安装可通过 py -3 / python 启动的 Python。不会切换 Mock。'
}

try {
    if (Test-OcrHealth) {
        Write-Host "OCR 已就绪：$base；Provider=paddleocr（复用已有服务，Python 路径以原服务为准）。"
        if ($Lan) { Write-Host '已有服务的监听范围未改变；如需局域网监听，请先手动停止它再用 -Lan 启动。' }
        exit 0
    }
    $python = Get-OcrPython
    Write-Host "OCR Python：$python"
    # Metadata probe only: do not import Paddle, initialize or download models.
    $probe = "import importlib.util,sys; names={'fastapi':'fastapi','uvicorn':'uvicorn','multipart':'python-multipart','PIL':'pillow','numpy':'numpy','fitz':'pymupdf','paddle':'paddlepaddle','paddleocr':'paddleocr'}; missing=[package for module,package in names.items() if importlib.util.find_spec(module) is None]; print(', '.join(missing)); sys.exit(1 if missing else 0)"
    $missing = & $python -I -B -c $probe
    if ($LASTEXITCODE -ne 0) { throw "OCR 依赖未准备好：$missing。请为所选 Python 准备 ocr-service\requirements.txt；脚本不会安装依赖、下载模型或退回 Mock。" }
    if ($CheckOnly) { Write-Host 'OCR 环境检查通过；未启动服务、未加载模型。'; exit 0 }
    $occupied = @([System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners() | Where-Object { $_.Port -eq 8001 })
    if ($occupied.Count) { throw '8001 端口已被占用，但不是健康的 PaddleOCR 服务。请检查原进程，不会自动结束它。' }
    $logId = [Guid]::NewGuid().ToString('N')
    $outLog = Join-Path ([IO.Path]::GetTempPath()) "courses-ocr-$logId.stdout.log"
    $errLog = Join-Path ([IO.Path]::GetTempPath()) "courses-ocr-$logId.stderr.log"
    $arguments = '-I -B -m uvicorn app:app --app-dir "{0}" --host {1} --port 8001 --no-proxy-headers' -f $PSScriptRoot, $bind
    $worker = Start-Process -FilePath $python -ArgumentList $arguments -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput $outLog -RedirectStandardError $errLog -PassThru
    Write-Host "OCR 进程 PID=$($worker.Id)；请求日志：$outLog；错误日志：$errLog"
    for ($i = 0; $i -lt 40; $i++) {
        if (Test-OcrHealth) {
            Write-Host "OCR 已就绪：$base；Provider=paddleocr；健康检查 $base/health。"
            Write-Host '后端应使用 OCR_PROVIDER=http、OCR_API_BASE=http://127.0.0.1:8001；AI 可独立保持 Mock。'
            Write-Host '首次图片识别可能加载或下载模型；脚本只做健康检查，不主动识别。'
            exit 0
        }
        if ($worker.HasExited) { throw "OCR 进程已退出，请查看错误日志：$errLog" }
        Start-Sleep -Seconds 1
    }
    throw "OCR 在 40 秒内未通过健康检查；未就绪，不会声称识别可用。请查看 $errLog（PID=$($worker.Id)）。"
} catch {
    Write-Host "OCR 启动未完成：$($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
