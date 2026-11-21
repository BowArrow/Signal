$ErrorActionPreference = 'Stop'
$workspace = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $workspace
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
$logFolder = Join-Path $workspace 'data/alex-operator'
New-Item -ItemType Directory -Path $logFolder -Force | Out-Null
& $nodePath 'apps/avatar-marketing/operator-cli.mjs' tick *> (Join-Path $logFolder 'worker-last-run.log')
exit $LASTEXITCODE
