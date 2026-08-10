[CmdletBinding()]
param(
  [switch] $KeepStopped
)

$ErrorActionPreference = "Stop"

$project = Split-Path -Parent $PSScriptRoot
$stateDirectory = Join-Path $project ".wrangler\scanner-service"
$outputDirectory = Join-Path $project "outputs\ec2"
$taskName = "QuantScope Background Scanner"
$port = 8791
$scannerConfigs = @(
  (Join-Path $project ".scanner-worker.jsonc"),
  (Join-Path $project "deploy\local\scanner-worker.jsonc")
)
$scannerSupervisors = @(
  (Join-Path $project ".scanner-service.ps1"),
  (Join-Path $project "scripts\local-scanner-service.ps1")
)
$timestamp = [DateTime]::UtcNow.ToString("yyyyMMdd-HHmmss")
$archive = Join-Path $outputDirectory "scanner-state-$timestamp.tar.gz"
$taskWasRunning = $false

if (-not (Test-Path -LiteralPath $stateDirectory)) {
  throw "Scanner state directory was not found: $stateDirectory"
}

$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
$taskWasRunning = $null -ne $task -and $task.State -eq "Running"

function Test-ScannerCommandLine([string] $CommandLine) {
  if ([string]::IsNullOrWhiteSpace($CommandLine)) {
    return $false
  }
  foreach ($path in @($scannerConfigs + $scannerSupervisors)) {
    if ($CommandLine.IndexOf(
      $path,
      [System.StringComparison]::OrdinalIgnoreCase
    ) -ge 0) {
      return $true
    }
  }
  return $false
}

$scannerWasRunning = @(
  Get-CimInstance Win32_Process |
    Where-Object { Test-ScannerCommandLine $_.CommandLine }
).Count -gt 0

New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null

function Stop-ScannerProcessTree {
  $processes = @(Get-CimInstance Win32_Process)
  $targetIds = [System.Collections.Generic.HashSet[uint32]]::new()

  foreach ($process in $processes) {
    if (Test-ScannerCommandLine $process.CommandLine) {
      $targetIds.Add([uint32] $process.ProcessId) | Out-Null
    }
  }

  do {
    $added = $false
    foreach ($process in $processes) {
      if ($targetIds.Contains([uint32] $process.ParentProcessId) -and
          $targetIds.Add([uint32] $process.ProcessId)) {
        $added = $true
      }
    }
  } while ($added)

  foreach ($processId in @($targetIds)) {
    Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
  }

  $listeners = @(
    Get-NetTCPConnection `
      -LocalPort $port `
      -State Listen `
      -ErrorAction SilentlyContinue
  )
  foreach ($listener in $listeners) {
    $listenerProcess = Get-CimInstance `
      Win32_Process `
      -Filter "ProcessId = $($listener.OwningProcess)" `
      -ErrorAction SilentlyContinue
    if ($listenerProcess.ExecutablePath -and
        $listenerProcess.ExecutablePath.StartsWith(
          $project,
          [System.StringComparison]::OrdinalIgnoreCase
        )) {
      Stop-Process `
        -Id $listener.OwningProcess `
        -Force `
        -ErrorAction SilentlyContinue
    }
  }
}

try {
  if ($taskWasRunning) {
    Stop-ScheduledTask -TaskName $taskName
  }

  $deadline = [DateTime]::UtcNow.AddSeconds(20)
  do {
    Stop-ScannerProcessTree
    $remaining = @(
      Get-CimInstance Win32_Process |
        Where-Object {
          Test-ScannerCommandLine $_.CommandLine
        }
    )
    if ($remaining.Count -eq 0) {
      break
    }
    Start-Sleep -Milliseconds 500
  } while ([DateTime]::UtcNow -lt $deadline)

  $remaining = @(
    Get-CimInstance Win32_Process |
      Where-Object {
        Test-ScannerCommandLine $_.CommandLine
      }
  )
  if ($remaining.Count -gt 0) {
    throw "Scanner processes could not be stopped safely."
  }

  & tar.exe -C $stateDirectory -czf $archive .
  if ($LASTEXITCODE -ne 0) {
    if (Test-Path -LiteralPath $archive) {
      $resolvedOutput = (Resolve-Path -LiteralPath $outputDirectory).Path
      $resolvedArchive = (Resolve-Path -LiteralPath $archive).Path
      if ($resolvedArchive.StartsWith(
          $resolvedOutput + [IO.Path]::DirectorySeparatorChar,
          [System.StringComparison]::OrdinalIgnoreCase
        )) {
        Remove-Item -LiteralPath $resolvedArchive -Force
      }
    }
    throw "Scanner state archive could not be created."
  }

  $result = Get-Item -LiteralPath $archive
  Write-Output "Scanner state exported: $($result.FullName) ($($result.Length) bytes)"
}
finally {
  if ($scannerWasRunning -and -not $KeepStopped -and $null -ne $task) {
    Start-ScheduledTask -TaskName $taskName
    Write-Output "The Windows scanner was restarted after the consistent snapshot."
  }
}

if ($KeepStopped) {
  Write-Warning "The Windows scanner remains stopped for EC2 cutover."
}
