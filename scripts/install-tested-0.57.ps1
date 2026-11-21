$ErrorActionPreference = 'Stop'
$signalWorkspace = Split-Path $PSScriptRoot -Parent
$signalReceiptPath = Join-Path $signalWorkspace 'data/operations-validation/release-0.57.json'
$signalReceipt = Get-Content -LiteralPath $signalReceiptPath -Raw | ConvertFrom-Json
$signalInstaller = Join-Path $signalWorkspace 'release/Signal Setup 0.57.0.exe'
$signalInstalledExe = Join-Path $env:LOCALAPPDATA 'Programs/signal/Signal.exe'
if (-not $signalReceipt.packagedUiPassed) { throw 'The packaged UI has not passed validation.' }
if ((Get-FileHash -LiteralPath $signalInstaller -Algorithm SHA256).Hash.ToLowerInvariant() -ne $signalReceipt.installerSha256) { throw 'The installer does not match the tested build.' }
$signalOpen = @(Get-Process Signal -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $signalInstalledExe })
if ($signalOpen.Count -gt 0) { throw 'Quit Signal from its tray menu before installing. This script does not close active work.' }
$signalProfile = Join-Path $env:APPDATA 'signal'
$signalBackup = Join-Path $signalProfile ('backups/before-0.57-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $signalBackup -Force | Out-Null
foreach ($signalFile in @('signal.db', 'signal.db-wal', 'signal.db-shm')) {
    $signalSource = Join-Path $signalProfile $signalFile
    if (Test-Path -LiteralPath $signalSource) { Copy-Item -LiteralPath $signalSource -Destination (Join-Path $signalBackup $signalFile) }
}
$signalSetup = Start-Process -FilePath $signalInstaller -ArgumentList '/S' -WindowStyle Hidden -PassThru
if (-not $signalSetup.WaitForExit(60000)) { throw 'Installer is still running. Wait for completion before retrying.' }
if ($signalSetup.ExitCode -ne 0) { throw ('Installer failed with exit code ' + $signalSetup.ExitCode) }
$signalInstalledAsar = Join-Path $env:LOCALAPPDATA 'Programs/signal/resources/app.asar'
if ((Get-FileHash -LiteralPath $signalInstalledAsar -Algorithm SHA256).Hash.ToLowerInvariant() -ne $signalReceipt.appAsarSha256) { throw 'Installed application does not match the tested package.' }
$signalReceipt.installed = $true
$signalReceipt | Add-Member -NotePropertyName backup -NotePropertyValue $signalBackup -Force
$signalReceipt | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $signalReceiptPath -Encoding UTF8
Write-Output 'Signal 0.57 installed; application hash matches the tested package. No production workers were started.'
