[CmdletBinding()]
param(
  [ValidateRange(1024, 65535)]
  [int] $Port = 8791,
  [string] $SyncUrl = "https://quantscope-terminal.hikmet-onur21.chatgpt.site/api/scanner/sync",
  [string] $SyncBearerToken = "",
  [string] $TriggerKey = "",
  [switch] $SkipRemoteSync
)

$ErrorActionPreference = "Stop"

$project = Split-Path -Parent $PSScriptRoot
$node = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
$wrangler = Join-Path $project "node_modules\wrangler\bin\wrangler.js"
$config = Join-Path $project "deploy\local\scanner-worker.jsonc"
$envFile = Join-Path $project ".env.local"
$stateDirectory = Join-Path $project ".wrangler\scanner-service"
$logDirectory = Join-Path $project ".wrangler"
$serviceLog = Join-Path $logDirectory "scanner-service.log"
$localStatusUrl = "http://127.0.0.1:$Port/api/scanner"
$scheduledUrl = "http://127.0.0.1:$Port/cdn-cgi/handler/scheduled"
$script:workerProcess = $null

New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
New-Item -ItemType Directory -Path $stateDirectory -Force | Out-Null

function Write-ScannerLog([string] $Message) {
  if ((Test-Path -LiteralPath $serviceLog) -and
      (Get-Item -LiteralPath $serviceLog).Length -gt 5MB) {
    Clear-Content -LiteralPath $serviceLog
  }
  Add-Content -LiteralPath $serviceLog -Value (
    "{0:o} {1}" -f [DateTime]::UtcNow, $Message
  )
}

function Test-ScannerListener {
  try {
    Invoke-WebRequest -Uri $localStatusUrl -UseBasicParsing -TimeoutSec 3 | Out-Null
    return $true
  } catch {
    return $false
  }
}

function ConvertTo-ProcessArgument([string] $Value) {
  if ($Value -notmatch '[\s"]') {
    return $Value
  }
  return '"' + $Value.Replace('"', '\"') + '"'
}

function Set-WorkerEnvironment([System.Diagnostics.ProcessStartInfo] $StartInfo) {
  $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  $userProfile = [Environment]::GetFolderPath("UserProfile")
  $localAppData = [Environment]::GetFolderPath("LocalApplicationData")
  $appData = [Environment]::GetFolderPath("ApplicationData")
  $systemRoot = [Environment]::GetEnvironmentVariable("SystemRoot", "Machine")
  if ([string]::IsNullOrWhiteSpace($systemRoot)) {
    $systemRoot = "C:\Windows"
  }
  $tempDirectory = [IO.Path]::GetTempPath().TrimEnd('\')
  $environment = [ordered]@{
    SystemRoot = $systemRoot
    WINDIR = $systemRoot
    ComSpec = Join-Path $systemRoot "System32\cmd.exe"
    USERPROFILE = $userProfile
    HOMEDRIVE = [IO.Path]::GetPathRoot($userProfile).TrimEnd('\')
    HOMEPATH = $userProfile.Substring([IO.Path]::GetPathRoot($userProfile).Length - 1)
    HOME = $userProfile
    APPDATA = $appData
    LOCALAPPDATA = $localAppData
    TEMP = $tempDirectory
    TMP = $tempDirectory
    ProgramData = [Environment]::GetFolderPath("CommonApplicationData")
    ProgramFiles = [Environment]::GetFolderPath("ProgramFiles")
    Path = (@($machinePath, $userPath) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }) -join ';'
  }
  $programFilesX86 = [Environment]::GetFolderPath("ProgramFilesX86")
  if (-not [string]::IsNullOrWhiteSpace($programFilesX86)) {
    $environment["ProgramFiles(x86)"] = $programFilesX86
  }
  foreach ($entry in $environment.GetEnumerator()) {
    if (-not [string]::IsNullOrWhiteSpace([string] $entry.Value)) {
      $StartInfo.EnvironmentVariables[$entry.Key] = [string] $entry.Value
    }
  }
}

function Stop-ScannerWorker {
  if ($null -eq $script:workerProcess) {
    return
  }
  try {
    if (-not $script:workerProcess.HasExited) {
      & "$env:SystemRoot\System32\taskkill.exe" /PID $script:workerProcess.Id /T /F | Out-Null
      $script:workerProcess.WaitForExit(10000) | Out-Null
    }
  } catch {
    Write-ScannerLog ("worker stop warning: " + $_.Exception.Message)
  } finally {
    $script:workerProcess.Dispose()
    $script:workerProcess = $null
  }
}

function Start-ScannerWorker {
  if (Test-ScannerListener) {
    return
  }
  if (-not (Test-Path -LiteralPath $node)) {
    throw "Node.js runtime bulunamadı: $node"
  }
  if (-not (Test-Path -LiteralPath $wrangler)) {
    throw "Wrangler runtime bulunamadı: $wrangler"
  }
  if (-not (Test-Path -LiteralPath $config)) {
    throw "Worker yapılandırması bulunamadı: $config"
  }
  if (-not (Test-Path -LiteralPath $envFile)) {
    throw "Yerel ortam dosyası bulunamadı: $envFile"
  }

  Stop-ScannerWorker
  $arguments = @(
    $wrangler,
    "dev",
    "--config", $config,
    "--port", [string] $Port,
    "--local",
    "--test-scheduled",
    "--persist-to", $stateDirectory,
    "--env-file", $envFile,
    "--log-level", "error",
    "--show-interactive-dev-session=false"
  )
  $startInfo = New-Object System.Diagnostics.ProcessStartInfo
  $startInfo.FileName = $node
  $startInfo.Arguments = ($arguments | ForEach-Object { ConvertTo-ProcessArgument ([string] $_) }) -join ' '
  $startInfo.WorkingDirectory = $project
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  Set-WorkerEnvironment $startInfo

  $script:workerProcess = New-Object System.Diagnostics.Process
  $script:workerProcess.StartInfo = $startInfo
  if (-not $script:workerProcess.Start()) {
    throw "Local scanner worker başlatılamadı."
  }
  Write-ScannerLog "Local scanner worker process started; pid=$($script:workerProcess.Id)."

  for ($attempt = 0; $attempt -lt 45; $attempt += 1) {
    Start-Sleep -Seconds 1
    if ($script:workerProcess.HasExited) {
      $exitCode = $script:workerProcess.ExitCode
      Stop-ScannerWorker
      throw "Local scanner worker erken kapandı; exit=$exitCode."
    }
    if (Test-ScannerListener) {
      Write-ScannerLog "Local scanner worker ready on port $Port."
      return
    }
  }
  Stop-ScannerWorker
  throw "Local scanner worker zamanında hazır olmadı."
}

function Sync-RemoteStatus($Status) {
  if ($SkipRemoteSync -or
      [string]::IsNullOrWhiteSpace($SyncBearerToken) -or
      [string]::IsNullOrWhiteSpace($TriggerKey)) {
    return $null
  }
  $headers = @{
    "Accept" = "application/json"
    "OAI-Sites-Authorization" = "Bearer $SyncBearerToken"
    "X-QuantScope-Trigger" = $TriggerKey
  }
  $payload = $Status | ConvertTo-Json -Depth 8 -Compress
  return Invoke-RestMethod -Uri $SyncUrl -Method Post -Headers $headers `
    -ContentType "application/json" -Body $payload -TimeoutSec 30
}

$mutexName = "Local\QuantScopeScannerService-$Port"
$created = $false
$mutex = New-Object System.Threading.Mutex($true, $mutexName, [ref] $created)
if (-not $created) {
  Write-ScannerLog "Another scanner supervisor already owns $mutexName; exiting."
  $mutex.Dispose()
  exit 0
}

Write-ScannerLog "QuantScope scanner supervisor started."
try {
  while ($true) {
    try {
      Start-ScannerWorker
      $nowMilliseconds = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
      $delayMilliseconds = 60250 - ($nowMilliseconds % 60000)
      Start-Sleep -Milliseconds $delayMilliseconds

      Invoke-WebRequest -Uri $scheduledUrl -UseBasicParsing -TimeoutSec 75 | Out-Null
      $status = Invoke-RestMethod -Uri $localStatusUrl -Method Get -TimeoutSec 20
      $sync = Sync-RemoteStatus $status
      if ($null -ne $sync) {
        Write-ScannerLog (
          "scan completed; local=$($status.config.scans_completed); " +
          "remote=$($sync.scans); alerts=$($status.config.alerts_sent)"
        )
      } else {
        Write-ScannerLog (
          "scan completed locally; scans=$($status.config.scans_completed); " +
          "alerts=$($status.config.alerts_sent)"
        )
      }
    } catch {
      Write-ScannerLog ("service error: " + $_.Exception.Message)
      if (-not (Test-ScannerListener)) {
        Stop-ScannerWorker
      }
      Start-Sleep -Seconds 10
    }
  }
} finally {
  Stop-ScannerWorker
  if ($created) {
    $mutex.ReleaseMutex()
  }
  $mutex.Dispose()
  Write-ScannerLog "QuantScope scanner supervisor stopped."
}
