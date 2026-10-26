[CmdletBinding()]
param([ValidateSet('Menu', 'Start', 'Stop', 'Status')][string]$Action = 'Menu', [switch]$NoOpen)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
. (Join-Path $PSScriptRoot 'service-control.ps1')
function Start-CourseServices {
    $shell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $arguments = @('-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $PSScriptRoot 'start-local.ps1'))
    if ($NoOpen) { $arguments += '-NoOpen' }
    & $shell @arguments | Out-Host
    return $LASTEXITCODE
}
try {
    switch ($Action) {
        'Start' { exit (Start-CourseServices) }
        'Stop' { Stop-LocalServices; exit 0 }
        'Status' { Show-LocalServiceStatus; exit 0 }
    }
    $result = Start-CourseServices
    if ($result -ne 0) { Write-Host '启动未完成，可在下方查看状态或重试。' -ForegroundColor Yellow }
    while ($true) {
        Write-Host ''
        Write-Host '课程网站服务管理' -ForegroundColor Cyan
        Write-Host '[1] 打开网站'
        Write-Host '[2] 停止本项目网站及 AI 服务'
        Write-Host '[3] 重新启动本项目服务'
        Write-Host '[4] 查看服务状态'
        Write-Host '[0] 关闭此窗口（保留服务运行）'
        $choice = Read-Host '请输入选项'
        switch ($choice) {
            '1' { if (Get-OwnWebsite) { Start-Process 'http://127.0.0.1:3000/' | Out-Null } else { $null = Start-CourseServices } }
            '2' { Stop-LocalServices }
            '3' { Stop-LocalServices; $null = Start-CourseServices }
            '4' { Show-LocalServiceStatus }
            '0' { exit 0 }
            default { Write-Host '请输入 0、1、2、3 或 4。' -ForegroundColor Yellow }
        }
    }
} catch { Write-Host "操作未完成：$($_.Exception.Message)" -ForegroundColor Red; exit 1 }
