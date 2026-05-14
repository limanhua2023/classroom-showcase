[CmdletBinding()]
param(
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path,
  [string]$TaskName = 'ClassShow Local Backup Agent',
  [string]$NodeExe = 'node',
  [string]$RunArguments = 'scripts/local-backup-agent.mjs --watch'
)

$ErrorActionPreference = 'Stop'

$resolvedProjectRoot = [System.IO.Path]::GetFullPath($ProjectRoot)
if (-not (Test-Path (Join-Path $resolvedProjectRoot 'scripts\\local-backup-agent.mjs'))) {
  throw "local-backup-agent.mjs was not found under $resolvedProjectRoot"
}

$action = New-ScheduledTaskAction -Execute $NodeExe -Argument $RunArguments -WorkingDirectory $resolvedProjectRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -StartWhenAvailable

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Description 'ClassShow local backup agent. Downloads cloud storage and metadata to the local backup root at user logon.' `
  -Force | Out-Null

Write-Output "Scheduled task installed: $TaskName"
