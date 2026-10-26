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
# Keep this project's current AI API separate from older services on 3002.
$localAiPort = 3003
$env:COURSES_LOCAL_AI_PORT = [string]$localAiPort
$projectHash = [System.Security.Cryptography.SHA256]::Create()
try { $localAiProjectId = ([BitConverter]::ToString($projectHash.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($projectRoot.ToLowerInvariant())))).Replace('-', '').ToLowerInvariant() }
finally { $projectHash.Dispose() }
. (Join-Path $projectRoot 'service-control.ps1')
. (Join-Path $projectRoot 'ai-python.ps1')

function Test-LoopbackPort([int]$Port) {
    $client = [System.Net.Sockets.TcpClient]::new()
    try {
        $task = $client.ConnectAsync('127.0.0.1', $Port)
        return ($task.Wait(300) -and $client.Connected)
    } catch { return $false }
    finally { $client.Dispose() }
}

function Test-WebsiteReady {
    try {
        $response = Invoke-WebRequest -Uri $url -TimeoutSec 2 -UseBasicParsing
        $identity = Invoke-RestMethod -Uri ($url + 'api/local-service') -TimeoutSec 2
        if ($identity.service -ne 'courses-local-website' -or $identity.project_id -ne $localAiProjectId) { return $false }
        if ($response.StatusCode -ne 200 -or $response.Content.Trim() -ne ([System.IO.File]::ReadAllText($frontedEntry)).Trim()) { return $false }
        $courses = Invoke-WebRequest -Uri ($url + 'api/courses') -TimeoutSec 2 -UseBasicParsing
        if ($courses.StatusCode -ne 200 -or -not $courses.Content.TrimStart().StartsWith('[')) { return $false }
        $null = ConvertFrom-Json -InputObject $courses.Content -ErrorAction Stop
        return $true
    } catch { return $false }
}

function Wait-Ready($Process, [int]$TimeoutSeconds = 60) {
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        $Process.Refresh()
        if ($Process.HasExited) { throw "后端已退出。请查看：$backendStderr" }
        if (Test-WebsiteReady) { return $true }
        Start-Sleep -Milliseconds 500
    }
    return $false
}

function Test-LocalAiReady {
    try {
        $response = Invoke-WebRequest -Uri "http://127.0.0.1:$localAiPort/api/ai/local-health" -TimeoutSec 2 -UseBasicParsing
        $health = ConvertFrom-Json -InputObject $response.Content -ErrorAction Stop
        return ($health.service -eq 'courses-local-ai' -and $health.api_version -eq 1 -and $health.project_id -eq $localAiProjectId -and @($health.routes) -contains '/api/ai/test' -and @($health.routes) -contains '/api/ai/vision-ocr')
    } catch { return $false }
}

function Start-LocalAi {
    if (Test-LoopbackPort $localAiPort) {
        if (-not (Test-LocalAiReady)) { throw "$localAiPort 端口已有其他项目或旧版 AI 服务，不会复用。" }
        Write-Host "本项目 AI 接口已就绪：http://127.0.0.1:$localAiPort"
        return
    }
    $previousPythonPath = $env:PYTHONPATH
    try {
        $env:PYTHONPATH = Join-Path $projectRoot '.local-ai-deps'
        $pythonCommand = Select-LocalAiPython -ProjectRoot $projectRoot -CheckOnly:$CheckOnly
        Write-Host "AI 使用 Python $($pythonCommand.Version)：$($pythonCommand.Source)"
        if ($CheckOnly) { Write-Host 'AI 依赖检查通过。'; return }
        $aiProcess = Start-Process -FilePath $pythonCommand.Source -ArgumentList '-B', 'local_runner.py' `
            -WorkingDirectory (Join-Path $projectRoot 'ai-fastapi') -WindowStyle Hidden -PassThru `
            -RedirectStandardOutput (Join-Path $projectRoot 'local-ai.stdout.log') -RedirectStandardError (Join-Path $projectRoot 'local-ai.stderr.log')
        $deadline = (Get-Date).AddSeconds(20)
        while ((Get-Date) -lt $deadline) {
            $aiProcess.Refresh()
            if ($aiProcess.HasExited) { throw 'AI 服务启动失败，请查看 local-ai.stderr.log。' }
            if (Test-LocalAiReady) { Write-Host "本项目 AI 接口已就绪：http://127.0.0.1:$localAiPort"; return }
            Start-Sleep -Milliseconds 300
        }
        throw 'AI 服务启动超时，请查看 local-ai.stderr.log。'
    } finally { $env:PYTHONPATH = $previousPythonPath }
}

try {
    Write-Host "项目目录：$projectRoot"
    if (-not (Test-Path -LiteralPath $frontedEntry)) { throw '找不到 fronted/index.html，项目不完整。' }
    if (-not (Test-Path -LiteralPath (Join-Path $backendPath 'server.js'))) { throw '找不到 back/server.js，项目不完整。' }
    $nodeCommand = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $nodeCommand) {
        throw '没有找到 Node.js，请先安装 Node.js 24 或更高版本。'
    }
    $nodePath = $nodeCommand.Source
    # Import SQLite without opening the user's database; resolve packages from this copy.
    $dependencyProbe = @'
try {
    const path = require('node:path');
    const { createRequire } = require('node:module');
    const { DatabaseSync } = require('node:sqlite');
    if (typeof DatabaseSync !== 'function') throw new Error('node:sqlite unavailable');
    const localRequire = createRequire(path.join(process.argv[1], 'package.json'));
    for (const name of ['express', 'cors', 'multer']) localRequire(name);
    console.log('Node.js ' + process.version + ' / SQLite / express / cors / multer OK');
} catch (error) { console.log(error.message); process.exitCode = 1; }
'@
    $dependencyResult = & $nodePath --no-warnings -e $dependencyProbe $backendPath
    if ($LASTEXITCODE -ne 0) {
        Write-Host ($dependencyResult -join [Environment]::NewLine) -ForegroundColor Yellow
        Write-Host '请使用 Node.js 24 或更新版本，并在 PowerShell 执行以下命令安装当前项目的后端依赖：' -ForegroundColor Yellow
        Write-Host ('  npm.cmd ci --prefix "' + $backendPath + '"') -ForegroundColor Yellow
        throw '后端运行环境或依赖不完整，尚未启动服务。'
    }
    Write-Host ($dependencyResult -join [Environment]::NewLine)

    # Verify the existing listener before starting any optional services.
    $websiteRunning = $false
    if (Test-LoopbackPort 3000) {
        if (-not (Test-WebsiteReady)) { throw '3000 端口已被其他服务占用，或课程网站尚未就绪。请检查占用进程后重试。' }
        $websiteRunning = $true
    }

    $officeModule = Join-Path $backendPath 'officePreview'
    $officeConverter = & node.exe -e "process.stdout.write(require(process.argv[1]).converterPath())" $officeModule 2>$null
    if ($officeConverter) {
        Write-Host 'Word/PPT 预览及旧版文字提取转换组件已找到。'
    } else {
        Write-Host '提示：未找到 LibreOffice，Word/PPT 在线预览和旧版 doc/ppt 文字提取暂不可用；附件保存、下载及新版 docx/pptx 文字提取仍可使用。' -ForegroundColor Yellow
        Write-Host '  安装 LibreOffice 后重启网站；非默认位置可通过 OFFICE_PREVIEW_CONVERTER 指定 soffice.com 的完整路径。' -ForegroundColor Yellow
    }

    if (-not (Test-Path -LiteralPath $ocrEntry)) {
        Write-Host '提示：浏览器端 OCR 资源缺失，图片识别会回退服务端，扫描 PDF 暂不可识别。' -ForegroundColor Yellow
        Write-Host '  修复：cd ocr-trial; npm install; cd ..; node tools/prepare-ocr-web.cjs' -ForegroundColor Yellow
    }

    $pdfReader = Join-Path $projectRoot 'fronted\vendor\ocr\pdfjs\pdf.min.js'
    $pdfWorker = Join-Path $projectRoot 'fronted\vendor\ocr\pdfjs\pdf.worker.min.js'
    if (-not (Test-Path -LiteralPath $pdfReader) -or -not (Test-Path -LiteralPath $pdfWorker)) {
        if (-not $CheckOnly) { & node.exe (Join-Path $projectRoot 'tools\prepare-pdf-preview.cjs') }
        if (-not (Test-Path -LiteralPath $pdfReader) -or -not (Test-Path -LiteralPath $pdfWorker)) {
            Write-Host '提示：PDF 阅读组件缺失。准备好 ocr-trial 依赖后运行 node tools/prepare-pdf-preview.cjs；网站和附件下载仍可使用。' -ForegroundColor Yellow
        }
    }

    $officeReader = Join-Path $projectRoot 'fronted\vendor\office\fflate.min.js'
    if (-not (Test-Path -LiteralPath $officeReader)) {
        if (-not $CheckOnly) { & node.exe (Join-Path $projectRoot 'tools\prepare-office-text.cjs') }
        if (-not (Test-Path -LiteralPath $officeReader)) {
            Write-Host '提示：Word/PPT 文字读取组件缺失。请在 ocr-trial 目录运行 npm install，再运行 node tools/prepare-office-text.cjs；网站其他功能仍可使用。' -ForegroundColor Yellow
        }
    }

    # AI 服务是可选的：起不来不影响网站本身
    try { Start-LocalAi }
    catch {
        $aiReason = [string]$_.Exception.Message
        if ($aiReason -like 'Traceback*' -or [string]::IsNullOrWhiteSpace($aiReason)) { $aiReason = 'Python AI 依赖未就绪' }
        Write-Host "提示：AI 服务未启动（$aiReason）。网站照常可用，仅 AI 相关功能不可用。" -ForegroundColor Yellow
        Write-Host '  需要 AI 时请按启动说明准备 Python 依赖，或暂时忽略。' -ForegroundColor Yellow
    }

    if ($websiteRunning) {
        if (Test-LocalAiReady) {
            try {
                $gatewayHealth = Invoke-WebRequest -Uri ($url + 'api/ai/local-health') -TimeoutSec 2 -UseBasicParsing
                $gatewayData = ConvertFrom-Json -InputObject $gatewayHealth.Content
                if ($gatewayData.project_id -ne $localAiProjectId) { throw 'project mismatch' }
            } catch { throw '网站后端仍使用旧版 AI 配置。请先停止后端，再重新运行启动课程网站。' }
        }
        if (-not $CheckOnly) { $null = Save-LocalServiceState }
        Write-Host "课程网站已经在运行：$url" -ForegroundColor Green
        if (-not $CheckOnly -and -not $NoOpen) { Start-Process -FilePath $url | Out-Null }
        exit 0
    }

    if ($CheckOnly) {
        Write-Host '检查通过：3000 空闲，可以启动。' -ForegroundColor Green
        exit 0
    }

    $backendStdout = Join-Path $projectRoot 'local-backend.stdout.log'
    $backendStderr = Join-Path $projectRoot 'local-backend.stderr.log'
    $backendProcess = Start-Process -FilePath $nodePath -ArgumentList '--env-file-if-exists=.env', 'server.js' `
        -WorkingDirectory $backendPath -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput $backendStdout -RedirectStandardError $backendStderr

    Write-Host '正在等待后端就绪…'
    if (-not (Wait-Ready $backendProcess 60)) {
        throw "后端没有在 60 秒内就绪。请查看：$backendStderr 和 $backendStdout"
    }

    if (Test-LocalAiReady) {
        $gatewayData = Invoke-RestMethod -Uri ($url + 'api/ai/local-health') -TimeoutSec 3
        if ($gatewayData.project_id -ne $localAiProjectId -or @($gatewayData.routes) -notcontains '/api/ai/vision-ocr') { throw '网站网关尚未连接当前项目的 AI 服务。请核对旧开发进程。' }
    }
    if (-not $NoOpen) { Start-Process -FilePath $url | Out-Null }
    $null = Save-LocalServiceState
    Write-Host "已启动：$url" -ForegroundColor Green
    Write-Host "后端进程 PID：$($backendProcess.Id)；日志：$backendStdout 和 $backendStderr"
    Write-Host '启动管理窗口输入 2 可停止本项目服务，也可双击“停止课程网站.bat”。'
} catch {
    Write-Host "启动未完成：$($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
