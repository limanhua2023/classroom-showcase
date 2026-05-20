param(
  [switch]$WhatIf
)

$ErrorActionPreference = 'Stop'

$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Resolve-Path (Join-Path $scriptPath '..')
$nodeCommand = (Get-Command node).Source
$taskName = 'ClassShow Secrets Backup Agent'
$taskAction = New-ScheduledTaskAction `
  -Execute $nodeCommand `
  -Argument 'scripts/secrets-backup-agent.mjs --once' `
  -WorkingDirectory $projectRoot

$taskTrigger = New-ScheduledTaskTrigger -Daily -At 3:35AM
$taskSettings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -StartWhenAvailable `
  -DontStopIfGoingOnBatteries

if ($WhatIf) {
  Write-Host "Would install scheduled task: $taskName"
  Write-Host "Node: $nodeCommand"
  Write-Host "Project: $projectRoot"
  Write-Host "Schedule: daily at 3:35 AM"
  exit 0
}

Register-ScheduledTask `
  -TaskName $taskName `
  -Action $taskAction `
  -Trigger $taskTrigger `
  -Settings $taskSettings `
  -Description 'Create an encrypted local and cloud secrets bundle for ClassShow every day.' `
  -Force | Out-Null

Write-Host "Installed scheduled task: $taskName"
