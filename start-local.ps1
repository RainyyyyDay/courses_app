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

try {
    Write-Host "项目目录：$projectRoot"
    if (-not (Test-Path -LiteralPath $frontedEntry)) { throw '找不到 fronted/index.html，项目不完整。' }
    if (-not (Test-Path -LiteralPath (Join-Path $backendPath 'server.js'))) { throw '找不到 back/server.js，项目不完整。' }
    if (-not (Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue)) {
        throw '没有找到 Node.js，请先安装 Node 20 或更高版本。'
    }

    # OCR 运行时资源 71MB 不入库，缺失时提示但不阻止启动（识别会自动回退服务端）
    if (-not (Test-Path -LiteralPath $ocrEntry)) {
        Write-Host '提示：浏览器端 OCR 资源缺失，识别会自动回退服务端。' -ForegroundColor Yellow
        Write-Host '  修复：cd ocr-trial; npm install; cd ..; node tools/prepare-ocr-web.cjs' -ForegroundColor Yellow
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

    # 独立窗口跑后端，日志和 Ctrl+C 都留在那个窗口里
    Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', 'title 课程网站 - 后端 && npm run dev' `
        -WorkingDirectory $backendPath -WindowStyle Normal | Out-Null

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
