$ErrorActionPreference = 'Stop'
$dashboardRoot = $PSScriptRoot
$dashboardUrl = 'http://127.0.0.1:4317'
try {
    $state = Invoke-RestMethod -Uri "$dashboardUrl/api/state" -TimeoutSec 2
    if ($state.tasks.Count -eq 3) { Start-Process $dashboardUrl; exit }
} catch {}
$nodeCommand = (Get-Command node -ErrorAction Stop).Source
$runtimePath = Join-Path $dashboardRoot '.local'
New-Item -ItemType Directory -Path $runtimePath -Force | Out-Null
$serverFile = Join-Path $dashboardRoot 'server.mjs'
$dashboardProcess = Start-Process -FilePath $nodeCommand -ArgumentList ('"' + $serverFile + '"') -WorkingDirectory $dashboardRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtimePath 'server.log') -RedirectStandardError (Join-Path $runtimePath 'server-error.log') -PassThru
$dashboardProcess.Id | Set-Content -LiteralPath (Join-Path $runtimePath 'server.pid')
for ($attempt=0; $attempt -lt 30; $attempt++) {
    try { $null = Invoke-RestMethod -Uri "$dashboardUrl/api/state" -TimeoutSec 1; Start-Process $dashboardUrl; exit }
    catch { Start-Sleep -Milliseconds 300 }
}
throw 'The dashboard did not start. Check .local/server-error.log.'
