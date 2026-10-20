[CmdletBinding()]
param(
    [ValidateSet('Main', 'Node', 'AI')][string]$Service = 'Main',
    [switch]$CheckOnly
)

# Windows PowerShell 5.1: this file is saved as UTF-8 with BOM.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$projectRoot = $PSScriptRoot
$backendPath = Join-Path $projectRoot 'back'
$aiPath = Join-Path $projectRoot 'ai-fastapi'
$dependencyPath = Join-Path $projectRoot '.local-ai-deps'
$frontendPath = Join-Path $projectRoot 'fronted\index.html'

function Get-OccupiedPorts {
    @([System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners() |
        Where-Object { $_.Port -in @(3000, 3002) } |
        Select-Object -ExpandProperty Port -Unique)
}

function Test-LoopbackPort([int]$Port) {
    $client = [System.Net.Sockets.TcpClient]::new()
    try {
        $task = $client.ConnectAsync('127.0.0.1', $Port)
        return ($task.Wait(300) -and $client.Connected)
    } catch { return $false }
    finally { $client.Dispose() }
}

function Assert-File([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "缺少项目文件：$Path"
    }
}

function Get-Tool([string]$Name) {
    $command = Get-Command $Name -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $command) { throw "未找到 $Name。请先安装相应运行环境并重新打开启动脚本；不会自动安装。" }
    return $command.Source
}

function Set-LocalEnvironment {
    # Override inherited provider/preload settings; never load a dotenv file.
    $env:AI_PROVIDER = 'mock'
    $env:AI_ENABLE_REAL = 'false'
    $env:OCR_PROVIDER = 'http'
    $env:OCR_API_BASE = 'http://127.0.0.1:8001'
    $env:PYTHONPATH = $dependencyPath
    Remove-Item Env:NODE_OPTIONS -ErrorAction SilentlyContinue
    Remove-Item Env:NPM_CONFIG_NODE_OPTIONS -ErrorAction SilentlyContinue
}

function Test-LocalOcrHealth {
    try { $health = Invoke-RestMethod -Uri 'http://127.0.0.1:8001/health' -TimeoutSec 2; return ($health.status -eq 'ok' -and $health.provider -eq 'paddleocr') }
    catch { return $false }
}

function Start-ServiceWindow([string]$Name) {
    # Visible consoles are intentional: the user needs logs and Ctrl+C access.
    $arguments = '-NoLogo -NoProfile -ExecutionPolicy Bypass -File "{0}" -Service {1}' -f $PSCommandPath, $Name
    Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList $arguments `
        -WorkingDirectory $projectRoot -WindowStyle Normal | Out-Null
}

if ($Service -ne 'Main') {
    $workerExitCode = 0
    try {
        Set-LocalEnvironment
        $port = if ($Service -eq 'Node') { 3000 } else { 3002 }
        $Host.UI.RawUI.WindowTitle = "课程网站 - $Service - 端口 $port"
        if ((Get-OccupiedPorts) -contains $port) { throw "端口 $port 已占用，未启动重复服务。" }
        if ($Service -eq 'Node') {
            if (-not (Test-LocalOcrHealth)) { Write-Warning 'OCR 暂不可用，网站继续启动；只有“识别文字”受影响，不会使用 Mock 假识别。稍后可单独启动 ocr-service\start.ps1。' }
            Set-Location -LiteralPath $backendPath
            $nodePath = Get-Tool 'node.exe'
            Write-Host '启动本地 Node 后端（AI=mock，OCR=http -> 127.0.0.1:8001；不加载 .env；会使用 back/data/app.db）…'
            & $nodePath server.js
        } else {
            Set-Location -LiteralPath $aiPath
            $pythonPath = Get-Tool 'python.exe'
            Write-Host '启动 FastAPI mock：127.0.0.1:3002（固定 mock，不使用真实模型）…'
            & $pythonPath -B -m uvicorn test_app:app --host 127.0.0.1 --port 3002 --no-proxy-headers
        }
        $workerExitCode = $LASTEXITCODE
        Write-Host "服务已退出，退出码：$workerExitCode" -ForegroundColor Yellow
    } catch {
        $workerExitCode = 1
        Write-Host "启动失败：$($_.Exception.Message)" -ForegroundColor Red
    } finally {
        Write-Host '窗口保留错误和运行信息。停止后可直接关闭此窗口。'
        Read-Host '按回车关闭窗口' | Out-Null
    }
    exit $workerExitCode
}

$mutex = $null
$ownsMutex = $false
$exitCode = 0
try {
    # One launcher per checkout, including simultaneous double-clicks.
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try { $key = [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($projectRoot.ToLowerInvariant()))).Replace('-', '') }
    finally { $sha.Dispose() }
    $mutex = [System.Threading.Mutex]::new($false, "Local\CoursesLocalLauncher-$key")
    try { $ownsMutex = $mutex.WaitOne(0) }
    catch [System.Threading.AbandonedMutexException] { $ownsMutex = $true }
    if (-not $ownsMutex) { throw '另一个启动脚本正在运行，请等待它完成，不要重复双击。' }

    Write-Host "项目目录：$projectRoot"
    Assert-File (Join-Path $backendPath 'package.json')
    Assert-File (Join-Path $backendPath 'server.js')
    Assert-File (Join-Path $aiPath 'test_app.py')
    Assert-File $frontendPath
    if (-not (Test-Path -LiteralPath $dependencyPath -PathType Container)) {
        throw '缺少 .local-ai-deps 本地依赖目录。请联系项目维护者准备依赖；脚本不会自动安装。'
    }
    $nodePath = Get-Tool 'node.exe'
    $pythonPath = Get-Tool 'python.exe'
    Set-LocalEnvironment
    $ocrScript = Join-Path $projectRoot 'ocr-service\start.ps1'
    $ocrCanStart = $false
    if (Test-Path -LiteralPath $ocrScript -PathType Leaf -ErrorAction SilentlyContinue) {
        try {
            & (Join-Path $PSHOME 'powershell.exe') -NoLogo -NoProfile -ExecutionPolicy Bypass -File $ocrScript -CheckOnly
            $ocrCanStart = ($LASTEXITCODE -eq 0)
        } catch { Write-Warning 'OCR 检查失败；不会影响网站启动。' }
    }
    if (-not $ocrCanStart) { Write-Warning 'OCR 环境暂未就绪；网站和 AI Mock 可照常使用，仅文字识别暂不可用。不会安装依赖或退回 Mock。' }

    Push-Location -LiteralPath $backendPath
    try {
        # Resolve dependencies and import the built-in SQLite module without opening any database.
        & $nodePath -e "require('node:sqlite'); for (const name of ['express','cors','multer']) require.resolve(name); console.log('Node dependencies OK')"
        if ($LASTEXITCODE -ne 0) { throw 'Node 版本或后端依赖不满足要求，请联系维护者处理。' }
    } finally { Pop-Location }
    & $pythonPath -B -c "import fastapi, uvicorn; print('FastAPI dependencies OK')"
    if ($LASTEXITCODE -ne 0) { throw 'Python 或 FastAPI 本地依赖不可用，请联系维护者处理。' }

    $occupied = @(Get-OccupiedPorts)
    if ($occupied.Count) {
        throw "端口 $($occupied -join '、') 已占用。可能已启动本网站或有其他程序占用。为避免重复启动，本次不启动任何服务；请先检查原服务窗口并停止后重试。不会自动结束其他进程。"
    }
    Write-Host '检查通过：Node 启动目录为 back，AI 启动目录为 ai-fastapi，3000/3002 端口空闲。' -ForegroundColor Green
    if (-not $CheckOnly) {
        Start-ServiceWindow 'Node'
        Start-ServiceWindow 'AI'
        Write-Host '正在等待服务就绪，最多 30 秒。失败详情请看两个独立服务窗口…'
        $deadline = [DateTime]::UtcNow.AddSeconds(30)
        $ready = $false
        do {
            if ((Test-LoopbackPort 3000) -and (Test-LoopbackPort 3002)) {
                try {
                    # Schema check only; no course data, database query or model request.
                    $schema = Invoke-RestMethod -Uri 'http://127.0.0.1:3002/openapi.json' -TimeoutSec 2
                    if ($schema.paths.'/api/ai/classify'.post) { $ready = $true; break }
                } catch { }
            }
            Start-Sleep -Milliseconds 500
        } while ([DateTime]::UtcNow -lt $deadline)
        if (-not $ready) { throw '服务未在等待时间内就绪，未自动打开页面。请查看 Node/AI 窗口；已启动的服务不会被自动终止，排错后请先停止再重试。' }
        Start-Process -FilePath 'http://127.0.0.1:3002/' | Out-Null
        Write-Host '两个服务已就绪，已打开本地网站 http://127.0.0.1:3002/ 。' -ForegroundColor Green
        Write-Host '服务状态：网页/AI http://127.0.0.1:3002/（AI=mock）；业务后端 http://127.0.0.1:3000（OCR_PROVIDER=http）。'
        # Open the website first: optional OCR startup must never gate website readiness.
        if ($ocrCanStart) {
            try {
                & (Join-Path $PSHOME 'powershell.exe') -NoLogo -NoProfile -ExecutionPolicy Bypass -File $ocrScript
                if ($LASTEXITCODE -ne 0) { Write-Warning 'OCR 启动失败；网站已打开，其他功能仍可使用。' }
            } catch { Write-Warning 'OCR 启动异常；网站保持运行，未切换 Mock。' }
        }
        if (Test-LocalOcrHealth) {
            Write-Host 'OCR：http://127.0.0.1:8001（Provider=paddleocr，健康检查通过）；日志/PID 见 OCR 启动输出。' -ForegroundColor Green
        } else {
            Write-Warning 'OCR：http://127.0.0.1:8001 暂不可用；网站可继续使用。之后单独运行 ocr-service\start.ps1 即可恢复识别，无需重启本次以 OCR_PROVIDER=http 启动的后端。'
        }
        Write-Host 'AI 独立演示：http://127.0.0.1:3002/demo'
        Write-Host '请使用上面的 HTTP 地址，AI 已同源接入固定 mock；不要直接双击 HTML 文件。'
        Write-Host '停止：分别在 Node、AI 两个窗口按 Ctrl+C；OCR 是独立后台进程，需按上方 PID 单独停止。关闭本启动窗口不会停止服务。'
    } else {
        Write-Host '网站环境检查完成（OCR 为可选项）：没有启动服务、打开网页或连接数据库。'
    }
} catch {
    Write-Host "启动未完成：$($_.Exception.Message)" -ForegroundColor Red
    $exitCode = 1
} finally {
    if ($ownsMutex) { $mutex.ReleaseMutex() }
    if ($mutex) { $mutex.Dispose() }
}
exit $exitCode
