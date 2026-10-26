# Local process ownership checks shared by the launcher and stop command.
$script:serviceRoot = $PSScriptRoot
$script:serviceStateFile = Join-Path $script:serviceRoot '.local-service-processes.json'
$hasher = [System.Security.Cryptography.SHA256]::Create()
try { $script:serviceProjectId = ([BitConverter]::ToString($hasher.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($script:serviceRoot.ToLowerInvariant())))).Replace('-', '').ToLowerInvariant() }
finally { $hasher.Dispose() }

function Get-OwnedProcessRecord([int]$ProcessId) {
    try {
        $proc = Get-Process -Id $ProcessId -ErrorAction Stop
        return [pscustomobject]@{ id = $proc.Id; started = [string]$proc.StartTime.ToUniversalTime().Ticks; executable = $proc.Path }
    } catch { return $null }
}
function Get-OwnWebsite {
    try {
        $identity = Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/local-service' -TimeoutSec 2
        if ($identity.service -eq 'courses-local-website' -and $identity.project_id -eq $script:serviceProjectId) {
            $listener = Get-NetTCPConnection -State Listen -LocalPort 3000 -ErrorAction Stop | Select-Object -First 1
            if ([int]$listener.OwningProcess -eq [int]$identity.pid) { return Get-OwnedProcessRecord ([int]$identity.pid) }
        }
    } catch {}
    return $null
}
function Read-LocalServiceState {
    try { return Get-Content -LiteralPath $script:serviceStateFile -Raw -Encoding UTF8 | ConvertFrom-Json }
    catch { return [pscustomobject]@{ project_id = $script:serviceProjectId; website = $null; aiWorker = $null; aiRunner = $null } }
}
function Save-LocalServiceState {
    $state = Read-LocalServiceState
    if ($state.project_id -ne $script:serviceProjectId) {
        # A copied project may contain the original copy's process record.
        $state = [pscustomobject]@{ project_id = $script:serviceProjectId; website = $null; aiWorker = $null; aiRunner = $null }
    }
    $website = Get-OwnWebsite
    if ($website) { $state.website = $website }
    try {
        $health = Invoke-RestMethod -Uri 'http://127.0.0.1:3003/api/ai/local-health' -TimeoutSec 2
        if ($health.service -eq 'courses-local-ai' -and $health.project_id -eq $script:serviceProjectId) {
            $workerId = [int](Get-NetTCPConnection -State Listen -LocalPort 3003 -ErrorAction Stop | Select-Object -First 1).OwningProcess
            $state.aiWorker = Get-OwnedProcessRecord $workerId
            $worker = Get-CimInstance Win32_Process -Filter "ProcessId=$workerId"
            $runner = Get-CimInstance Win32_Process -Filter "ProcessId=$($worker.ParentProcessId)"
            if ($runner.Name -eq 'python.exe' -and $runner.CommandLine -match '(?:^|\s|["''])local_runner\.py(?:["'']|\s|$)') {
                $state.aiRunner = Get-OwnedProcessRecord ([int]$runner.ProcessId)
            }
        }
    } catch {}
    $state | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $script:serviceStateFile -Encoding UTF8
    return $state
}
function Stop-LocalServices {
    $state = Save-LocalServiceState
    # Stop the reloader before the worker so it cannot immediately restart it.
    foreach ($name in @('aiRunner', 'aiWorker', 'website')) {
        $saved = $state.$name
        if (-not $saved) { continue }
        $current = Get-OwnedProcessRecord ([int]$saved.id)
        if (-not $current) { continue }
        if ($current.started -ne $saved.started -or $current.executable -ne $saved.executable) {
            Write-Host "已跳过旧进程记录 $($saved.id)：该 PID 已被其他进程使用。" -ForegroundColor Yellow
            continue
        }
        Stop-Process -Id ([int]$saved.id) -Force -ErrorAction Stop
        Write-Host "已停止本项目 $name（PID $($saved.id)）"
    }
    $deadline = (Get-Date).AddSeconds(5)
    do {
        $running = $false
        foreach ($name in @('aiRunner', 'aiWorker', 'website')) {
            $saved = $state.$name
            if ($saved) { $current = Get-OwnedProcessRecord ([int]$saved.id); if ($current -and $current.started -eq $saved.started) { $running = $true } }
        }
        if (-not $running) { break }
        Start-Sleep -Milliseconds 200
    } while ((Get-Date) -lt $deadline)
    if ($running) { throw '部分本项目进程仍未退出，请稍后重试停止。' }
    Remove-Item -LiteralPath $script:serviceStateFile -Force -ErrorAction SilentlyContinue
    Write-Host '本项目网站及 AI 服务已停止；文件、课程数据和 AI 配置均已保留。' -ForegroundColor Green
}
function Show-LocalServiceStatus {
    $website = Get-OwnWebsite
    if ($website) { Write-Host "本项目网站：运行中（PID $($website.id)）" -ForegroundColor Green }
    else { Write-Host '本项目网站：未运行；如果 3000 被其他项目占用，不会停止该项目。' }
    try {
        $health = Invoke-RestMethod -Uri 'http://127.0.0.1:3003/api/ai/local-health' -TimeoutSec 2
        if ($health.project_id -eq $script:serviceProjectId) { Write-Host '本项目 AI：运行中' -ForegroundColor Green; return }
    } catch {}
    Write-Host '本项目 AI：未运行'
}
