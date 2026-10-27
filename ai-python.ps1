# Windows PowerShell 5.1: keep UTF-8 with BOM.
function Invoke-AiPythonProbe([string]$Executable, [string]$Arguments) {
    $info = New-Object System.Diagnostics.ProcessStartInfo
    $info.FileName = $Executable
    $info.Arguments = $Arguments
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $info
    try {
        $null = $process.Start()
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit(15000)) {
            $process.Kill()
            return [pscustomobject]@{ Code = -1; Output = ''; Error = '检查超过 15 秒' }
        }
        return [pscustomobject]@{ Code = $process.ExitCode; Output = $stdout.Result; Error = $stderr.Result }
    } catch {
        return [pscustomobject]@{ Code = -1; Output = ''; Error = $_.Exception.Message }
    } finally { $process.Dispose() }
}

function Select-LocalAiPython([string]$ProjectRoot, [switch]$CheckOnly) {
    $candidates = New-Object 'System.Collections.Generic.List[string]'
    $explicit = $env:COURSES_AI_PYTHON
    if ($explicit) {
        $candidates.Add($explicit)
    } else {
        foreach ($relative in @('ai-fastapi\.venv\Scripts\python.exe', '.venv\Scripts\python.exe')) {
            $candidate = Join-Path $ProjectRoot $relative
            if (Test-Path -LiteralPath $candidate -PathType Leaf) { $candidates.Add($candidate) }
        }
        foreach ($command in @(Get-Command python.exe -All -CommandType Application -ErrorAction SilentlyContinue)) {
            if ($command.Source -notmatch '\\Microsoft\\WindowsApps\\') { $candidates.Add($command.Source) }
        }
        $launcher = Get-Command py.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($launcher) {
            $installed = Invoke-AiPythonProbe $launcher.Source '-0p'
            foreach ($line in ($installed.Output -split '\r?\n')) {
                if ($line -match '([A-Za-z]:\\.*?\.exe)\s*$') { $candidates.Add($Matches[1]) }
            }
        }
    }
    $report = New-Object 'System.Collections.Generic.List[string]'
    $selected = $null
    foreach ($candidate in @($candidates | Select-Object -Unique)) {
        $result = Invoke-AiPythonProbe $candidate '-B -c "import sys, fastapi, uvicorn, httpx; print(sys.version.split()[0]); print(sys.executable)"'
        if ($result.Code -eq 0) {
            $lines = @($result.Output.Trim() -split '\r?\n')
            if ($lines.Count -ge 2 -and (Test-Path -LiteralPath $lines[-1] -PathType Leaf)) {
                $selected = [pscustomobject]@{ Source = $lines[-1]; Version = $lines[-2] }
                $report.Add("可用：$($selected.Source) / Python $($selected.Version)")
                break
            }
        }
        $detail = $result.Error.Trim()
        if (-not $detail) { $detail = "依赖检查失败，退出码 $($result.Code)" }
        $report.Add("不可用：$candidate`r`n$detail")
    }
    if (-not $CheckOnly) {
        $log = Join-Path $ProjectRoot 'local-ai-environment.log'
        [IO.File]::WriteAllText($log, ($report -join "`r`n`r`n"), [Text.UTF8Encoding]::new($true))
    }
    if (-not $selected) {
        if ($candidates.Count -eq 0) { throw '未找到 Python，请安装 Python 或设置 COURSES_AI_PYTHON 为可用的 python.exe 路径。' }
        $reason = (($report[-1] -split '\r?\n')[-1]).Trim()
        $hint = if ($CheckOnly) { '检查模式未写入日志。' } else { '详情见 local-ai-environment.log。' }
        throw "已检查 $($candidates.Count) 个 Python 环境，AI 依赖均未通过：$reason。$hint"
    }
    return $selected
}
