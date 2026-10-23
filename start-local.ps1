[CmdletBinding()]
param([switch]$CheckOnly, [switch]$NoOpen)

# Windows PowerShell 5.1: this file must stay UTF-8 with BOM.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$projectRoot = $PSScriptRoot
$backendPath = Join-Path $projectRoot 'back'
$frontedEntry = Join-Path $projectRoot 'fronted\index.html'
$ocrEntry = Join-Path $projectRoot 'fronted\vendor\ocr\paddleocr-js.iife.js'
$url = 'http://127.0.0.1:3000/'

function Test-LoopbackPort([int]$Port) {
    $client = [System.Net.Sockets.TcpClient]::new()
    try {
        $task = $client.ConnectAsync('127.0.0.1', $Port)
        return ($task.Wait(300) -and $client.Connected)
    } catch { return $false }
    finally { $client.Dispose() }
}

function Wait-Ready([int]$TimeoutSeconds = 60) {
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        try {
            $response = Invoke-WebRequest -Uri $url -TimeoutSec 2 -UseBasicParsing
            if ($response.StatusCode -eq 200) { return $true }
        } catch { }
        Start-Sleep -Milliseconds 500
    }
    return $false
}

function Start-LocalAi {
    if (Test-LoopbackPort 3002) { return }
    $pythonCommand = Get-Command python.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $pythonCommand) { throw 'AI 服务需要 Python，请先安装 Python。' }
    $previousPythonPath = $env:PYTHONPATH
    try {
        $env:PYTHONPATH = Join-Path $projectRoot '.local-ai-deps'
        & $pythonCommand.Source -B -c 'import fastapi, uvicorn, httpx' 2>$null
        if ($LASTEXITCODE -ne 0) { throw '缺少 AI 服务依赖，请按启动说明准备 FastAPI、uvicorn 和 httpx。' }
        if ($CheckOnly) { Write-Host 'AI 依赖检查通过。'; return }
        $aiProcess = Start-Process -FilePath $pythonCommand.Source -ArgumentList '-B', 'local_runner.py' `
            -WorkingDirectory (Join-Path $projectRoot 'ai-fastapi') -WindowStyle Hidden -PassThru `
            -RedirectStandardOutput (Join-Path $projectRoot 'local-ai.stdout.log') -RedirectStandardError (Join-Path $projectRoot 'local-ai.stderr.log')
        $deadline = (Get-Date).AddSeconds(20)
        while ((Get-Date) -lt $deadline) {
            if ($aiProcess.HasExited) { throw 'AI 服务启动失败，请查看 local-ai.stderr.log。' }
            if (Test-LoopbackPort 3002) { Write-Host '本机 AI 服务已启动。'; return }
            Start-Sleep -Milliseconds 300
        }
        throw 'AI 服务启动超时，请查看 local-ai.stderr.log。'
    } finally { $env:PYTHONPATH = $previousPythonPath }
}

try {
    Write-Host "项目目录：$projectRoot"
    if (-not (Test-Path -LiteralPath $frontedEntry)) { throw '找不到 fronted/index.html，项目不完整。' }
    if (-not (Test-Path -LiteralPath (Join-Path $backendPath 'server.js'))) { throw '找不到 back/server.js，项目不完整。' }
    if (-not (Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue)) {
        throw '没有找到 Node.js，请先安装 Node 20 或更高版本。'
    }

    if (-not (Test-Path -LiteralPath $ocrEntry)) {
        Write-Host '提示：浏览器端 OCR 资源缺失，识别会自动回退服务端。' -ForegroundColor Yellow
        Write-Host '  修复：cd ocr-trial; npm install; cd ..; node tools/prepare-ocr-web.cjs' -ForegroundColor Yellow
    }

    # AI 服务是可选的：起不来不影响网站本身
    try { Start-LocalAi }
    catch {
        $aiReason = [string]$_.Exception.Message
        if ($aiReason -like 'Traceback*' -or [string]::IsNullOrWhiteSpace($aiReason)) { $aiReason = 'Python AI 依赖未就绪' }
        Write-Host "提示：AI 服务未启动（$aiReason）。网站照常可用，仅 AI 相关功能不可用。" -ForegroundColor Yellow
        Write-Host '  需要 AI 时请按启动说明准备 Python 依赖，或暂时忽略。' -ForegroundColor Yellow
    }

    if (Test-LoopbackPort 3000) {
        Write-Host '3000 端口已有服务在运行，直接打开页面。' -ForegroundColor Green
        if (-not $CheckOnly -and -not $NoOpen) { Start-Process -FilePath $url | Out-Null }
        exit 0
    }

    if ($CheckOnly) {
        Write-Host '检查通过：3000 空闲，可以启动。' -ForegroundColor Green
        exit 0
    }

    Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', 'title 课程网站 - 后端 && npm run dev' `
        -WorkingDirectory $backendPath -WindowStyle Hidden | Out-Null

    Write-Host '正在等待后端就绪…'
    if (-not (Wait-Ready 60)) {
        throw '后端没有在 60 秒内就绪，请查看新打开的后端窗口里的报错。'
    }

    if (-not $NoOpen) { Start-Process -FilePath $url | Out-Null }
    Write-Host "已启动：$url" -ForegroundColor Green
    Write-Host '停止服务：到“课程网站 - 后端”窗口按 Ctrl+C，或直接关闭那个窗口。'
} catch {
    Write-Host "启动未完成：$($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
