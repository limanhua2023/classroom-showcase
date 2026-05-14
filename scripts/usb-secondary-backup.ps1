[CmdletBinding()]
param(
  [string]$SourceRoot = $env:LOCAL_BACKUP_ROOT,
  [string]$DestinationRoot = $env:USB_BACKUP_ROOT,
  [string]$DriveLetter = '',
  [string]$VolumeLabel = '',
  [switch]$MirrorLatest
)

$ErrorActionPreference = 'Stop'

function Resolve-BackupDestination {
  param(
    [string]$DestinationRoot,
    [string]$DriveLetter,
    [string]$VolumeLabel
  )

  if ($DestinationRoot) {
    return [System.IO.Path]::GetFullPath($DestinationRoot)
  }

  if ($DriveLetter) {
    $normalized = $DriveLetter.TrimEnd(':')
    return [System.IO.Path]::GetFullPath("${normalized}:\ClassShow-USB-Backup")
  }

  if ($VolumeLabel) {
    $volume = Get-Volume | Where-Object { $_.FileSystemLabel -eq $VolumeLabel } | Select-Object -First 1
    if (-not $volume) {
      throw "USB volume label '$VolumeLabel' was not found."
    }
    return [System.IO.Path]::GetFullPath("$($volume.DriveLetter):\ClassShow-USB-Backup")
  }

  throw 'Set USB_BACKUP_ROOT or pass -DestinationRoot / -DriveLetter / -VolumeLabel.'
}

function Invoke-RobocopySafe {
  param(
    [string]$SourcePath,
    [string]$TargetPath
  )

  New-Item -ItemType Directory -Force -Path $TargetPath | Out-Null
  $arguments = @(
    $SourcePath,
    $TargetPath,
    '/E',
    '/R:2',
    '/W:2',
    '/XO',
    '/FFT',
    '/COPY:DAT',
    '/DCOPY:DAT',
    '/MT:8',
    '/NFL',
    '/NDL',
    '/NP'
  )
  & robocopy @arguments | Out-Null
  $code = $LASTEXITCODE
  if ($code -ge 8) {
    throw "robocopy failed with exit code $code"
  }
  return $code
}

if (-not $SourceRoot) {
  throw 'LOCAL_BACKUP_ROOT is not set and -SourceRoot was not provided.'
}

$resolvedSourceRoot = [System.IO.Path]::GetFullPath($SourceRoot)
$currentRoot = Join-Path $resolvedSourceRoot 'current'
if (-not (Test-Path $currentRoot)) {
  throw "Backup source '$currentRoot' does not exist. Run the local backup agent first."
}

$resolvedDestinationRoot = Resolve-BackupDestination -DestinationRoot $DestinationRoot -DriveLetter $DriveLetter -VolumeLabel $VolumeLabel
New-Item -ItemType Directory -Force -Path $resolvedDestinationRoot | Out-Null

$timestamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$snapshotRoot = Join-Path $resolvedDestinationRoot "snapshots\\classshow_backup_$timestamp"
$latestRoot = Join-Path $resolvedDestinationRoot 'latest'
$reportRoot = Join-Path $resolvedDestinationRoot 'reports'

$sourceReports = Join-Path $resolvedSourceRoot 'reports'
$report = [ordered]@{
  generated_at = (Get-Date).ToString('o')
  source_root = $resolvedSourceRoot
  source_current = $currentRoot
  destination_root = $resolvedDestinationRoot
  snapshot_root = $snapshotRoot
  latest_root = $latestRoot
  mirror_latest = [bool]$MirrorLatest
  snapshot_copy = $null
  latest_copy = $null
}

$report.snapshot_copy = Invoke-RobocopySafe -SourcePath $currentRoot -TargetPath $snapshotRoot

if ($MirrorLatest) {
  $report.latest_copy = Invoke-RobocopySafe -SourcePath $currentRoot -TargetPath $latestRoot
}

if (Test-Path $sourceReports) {
  New-Item -ItemType Directory -Force -Path $reportRoot | Out-Null
  $latestReport = Join-Path $sourceReports 'latest-report.json'
  if (Test-Path $latestReport) {
    Copy-Item -Force $latestReport (Join-Path $reportRoot 'latest-report.json')
  }
}

$reportFile = Join-Path $resolvedDestinationRoot "usb-backup-report_$timestamp.json"
$report | ConvertTo-Json -Depth 6 | Set-Content -Encoding UTF8 $reportFile
Write-Output ("USB backup complete: " + $reportFile)
