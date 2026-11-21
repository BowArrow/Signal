$ErrorActionPreference = 'Stop'
$studioWorkspace = Split-Path $PSScriptRoot -Parent
$studioFolder = Join-Path $studioWorkspace 'data/demo-studio'
$studioConnection = Join-Path $studioFolder 'connection.json'
New-Item -ItemType Directory -Path $studioFolder -Force | Out-Null
$studioReady = $false
if (Test-Path -LiteralPath $studioConnection) {
    try {
        $studioConfig = Get-Content -LiteralPath $studioConnection -Raw | ConvertFrom-Json
        if ($studioConfig.url -notmatch '^http://127\.0\.0\.1:\d+$') { throw 'Unexpected studio address' }
        $null = Invoke-RestMethod -Uri ($studioConfig.url + '/api/status') -Headers @{ Authorization = ('Bearer ' + $studioConfig.token) } -TimeoutSec 2
        $studioReady = $true
    } catch { $studioReady = $false }
}
if (-not $studioReady) {
    $studioNode = (Get-Command node.exe).Source
    $studioServer = Join-Path $studioWorkspace 'apps/demo-studio/server.mjs'
    $studioProcess = Start-Process -FilePath $studioNode -ArgumentList ('"' + $studioServer + '"') -WorkingDirectory $studioWorkspace -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $studioFolder 'server.log') -RedirectStandardError (Join-Path $studioFolder 'server-error.log')
    for ($studioAttempt = 0; $studioAttempt -lt 40; $studioAttempt++) {
        Start-Sleep -Milliseconds 250
        if ($studioProcess.HasExited) { throw ('Demo Studio stopped. See ' + (Join-Path $studioFolder 'server-error.log')) }
        try {
            $studioConfig = Get-Content -LiteralPath $studioConnection -Raw | ConvertFrom-Json
            if ($studioConfig.pid -ne $studioProcess.Id) { continue }
            $null = Invoke-RestMethod -Uri ($studioConfig.url + '/api/status') -Headers @{ Authorization = ('Bearer ' + $studioConfig.token) } -TimeoutSec 1
            $studioReady = $true
            break
        } catch { }
    }
}
if (-not $studioReady) { throw 'Demo Studio did not become ready. Check data/demo-studio/server-error.log.' }
$studioDiscovery = Join-Path $env:LOCALAPPDATA 'Signal/demo-studio'
New-Item -ItemType Directory -Path $studioDiscovery -Force | Out-Null
Copy-Item -LiteralPath $studioConnection -Destination (Join-Path $studioDiscovery 'connection.json') -Force
$studioUrl = $studioConfig.url + '/#key=' + $studioConfig.token
$studioBrowser = @(
    (Join-Path ${env:ProgramFiles(x86)} 'Microsoft/Edge/Application/msedge.exe'),
    (Join-Path $env:ProgramFiles 'Google/Chrome/Application/chrome.exe')
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if ($studioBrowser) {
    Start-Process -FilePath $studioBrowser -ArgumentList @('--app="' + $studioUrl + '"', '--window-size=1440,1000') -WindowStyle Hidden
} else { Start-Process $studioUrl -WindowStyle Hidden }
Write-Output 'Demo Studio is running. Use Open Lemonade to start a separate demo workspace.'
