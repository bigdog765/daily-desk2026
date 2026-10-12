$pidFile = Join-Path $PSScriptRoot '.local/server.pid'
if (Test-Path -LiteralPath $pidFile) {
    $dashboardProcessId = [int](Get-Content -LiteralPath $pidFile)
    $dashboardProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $dashboardProcessId"
    $serverFile = Join-Path $PSScriptRoot 'server.mjs'
    if ($dashboardProcess -and $dashboardProcess.CommandLine.Contains($serverFile)) {
        Stop-Process -Id $dashboardProcessId
        Write-Host 'Dashboard stopped.'
    }
}
