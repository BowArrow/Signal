param([string]$ComfyUrl = 'http://127.0.0.1:8200', [int]$Minutes = 40)
$ErrorActionPreference = 'Stop'
$videoValidation = Join-Path $PSScriptRoot '../data/video-h3-validation'
$videoJob = Get-Content -LiteralPath (Join-Path $videoValidation 'job.json') -Raw | ConvertFrom-Json
$videoMetrics = Join-Path $videoValidation 'resources.jsonl'
$videoDeadline = (Get-Date).AddMinutes($Minutes)
while ((Get-Date) -lt $videoDeadline) {
  $videoGpu = (& nvidia-smi --query-gpu=memory.used,utilization.gpu,temperature.gpu --format=csv,noheader,nounits) -split ',\s*'
  $videoMemory = Get-CimInstance Win32_PerfFormattedData_PerfOS_Memory
  $videoSample = [ordered]@{ time = (Get-Date).ToUniversalTime().ToString('o'); gpuUsedMiB = [int]$videoGpu[0]; gpuPercent = [int]$videoGpu[1]; gpuCelsius = [int]$videoGpu[2]; availableRamMiB = $videoMemory.AvailableMBytes; committedPercent = $videoMemory.PercentCommittedBytesInUse }
  $videoSample | ConvertTo-Json -Compress | Add-Content -LiteralPath $videoMetrics
  $videoHistory = Invoke-RestMethod -Uri ($ComfyUrl + '/history/' + $videoJob.remote.id) -TimeoutSec 5
  $videoResult = $videoHistory.PSObject.Properties[$videoJob.remote.id].Value
  if ($videoResult.status.completed -or $videoResult.status.status_str -eq 'error') {
    [ordered]@{ completed = $videoResult.status.completed; status = $videoResult.status.status_str; samples = (Get-Content -LiteralPath $videoMetrics).Count } | ConvertTo-Json -Compress
    break
  }
  Start-Sleep -Seconds 10
}
