$ErrorActionPreference = 'Stop'
$workspace = Split-Path -Parent $PSScriptRoot
$workerPath = Join-Path $workspace 'scripts/alex-production-worker.ps1'
if (-not (Test-Path -LiteralPath $workerPath)) { throw 'Production worker script is missing.' }
$taskName = 'Signal-Alex-Production-Worker'
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing) {
  if (($existing.Actions.Arguments -join ' ') -notlike "*$workerPath*") { throw 'A different task uses this name; it was not changed.' }
  $existing | Select-Object TaskName, State
  exit 0
}
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -NonInteractive -WindowStyle Hidden -File "{0}"' -f $workerPath) -WorkingDirectory $workspace
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(2) -RepetitionInterval (New-TimeSpan -Minutes 30)
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 5) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$principal = New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description 'Process one queued Alex video locally, with model safeguards and game-aware deferral. Does not publish or create paid AI tasks.' | Select-Object TaskName, State
