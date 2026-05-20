$ErrorActionPreference = 'Stop'

$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Resolve-Path (Join-Path $scriptPath '..')
$nodeCommand = (Get-Command node).Source
$taskName = 'ClassShow Project Backup Agent'
$taskAction = New-ScheduledTaskAction `
  -Execute $nodeCommand `
  -Argument 'scripts/project-backup-agent.mjs --once' `
  -WorkingDirectory $projectRoot

$taskTrigger = New-ScheduledTaskTrigger -Daily -At 3:15AM
$taskSettings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -StartWhenAvailable `
  -DontStopIfGoingOnBatteries

Register-ScheduledTask `
  -TaskName $taskName `
  -Action $taskAction `
  -Trigger $taskTrigger `
  -Settings $taskSettings `
  -Description 'Create a local and cloud code/config snapshot for ClassShow every day.' `
  -Force | Out-Null

Write-Host "Installed scheduled task: $taskName"
