$ErrorActionPreference = "Stop"

$directory = $env:CORE_SQL_DIRECTORY
$database = $env:CORE_D1_DATABASE
if (-not $directory) { throw "CORE_SQL_DIRECTORY is required" }
if (-not $database) { throw "CORE_D1_DATABASE is required" }

$directory = [System.IO.Path]::GetFullPath($directory)
$manifestPath = Join-Path $directory "manifest.json"
if (-not (Test-Path -LiteralPath $manifestPath)) { throw "SQL manifest does not exist: $manifestPath" }

$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if ($manifest.format -ne 2 -or $manifest.finalization -ne "import_complete") {
  throw "unsupported or incomplete compact SQL manifest"
}

$manifestHash = (Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash.ToLowerInvariant()
$defaultStatePath = Join-Path (Split-Path $directory) "$(Split-Path $directory -Leaf)-$database-import.json"
$statePath = if ($env:CORE_IMPORT_STATE) { [System.IO.Path]::GetFullPath($env:CORE_IMPORT_STATE) } else { $defaultStatePath }
$wranglerDirectory = Split-Path $PSScriptRoot

function Invoke-Wrangler([string[]]$Arguments) {
  Push-Location $wranglerDirectory
  try {
    $maxAttempts = 8
    for ($attempt = 1; $attempt -le $maxAttempts; $attempt++) {
      & npx.cmd wrangler @Arguments
      if ($LASTEXITCODE -eq 0) { return }
      if ($attempt -eq $maxAttempts) { throw "wrangler exited with status $LASTEXITCODE after $attempt attempts" }
      $delay = [Math]::Min(300, 60 * $attempt)
      Write-Warning "wrangler attempt $attempt failed with status $LASTEXITCODE; retrying in $delay seconds"
      Start-Sleep -Seconds $delay
    }
  } finally {
    Pop-Location
  }
}

function Read-RemoteRows([string]$Sql) {
  Push-Location $wranglerDirectory
  try {
    $output = & npx.cmd wrangler d1 execute $database --remote --command $Sql --json
    if ($LASTEXITCODE -ne 0) { throw "wrangler exited with status $LASTEXITCODE" }
    $response = $output | ConvertFrom-Json
    if (@($response | Where-Object { -not $_.success }).Count -gt 0) { throw "unexpected D1 query response" }
    return @($response | ForEach-Object { $_.results })
  } finally {
    Pop-Location
  }
}

foreach ($file in $manifest.files) {
  $path = Join-Path $directory $file.file
  if (-not (Test-Path -LiteralPath $path)) { throw "$($file.file) is missing" }
  if ((Get-Item -LiteralPath $path).Length -ne $file.bytes) { throw "$($file.file) size mismatch" }
  $hash = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($hash -ne $file.sha256) { throw "$($file.file) SHA-256 mismatch" }
}

$expectedTables = @($manifest.tables.PSObject.Properties.Name | Sort-Object)
$remoteTables = @(Read-RemoteRows "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('d1_migrations','_cf_KV') ORDER BY name" | ForEach-Object { [string]$_.name })
if (($expectedTables -join "`n") -ne ($remoteTables -join "`n")) { throw "remote compact table set does not match the artifact" }

if (Test-Path -LiteralPath $statePath) {
  $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
  if ($state.database -ne $database -or $state.manifest_sha256 -ne $manifestHash) {
    throw "import checkpoint does not match this database and manifest: $statePath"
  }
} else {
  $rows = @(Read-RemoteRows "SELECT EXISTS(SELECT 1 FROM address_dictionary)+EXISTS(SELECT 1 FROM core_state) AS imported")
  if ([int64]$rows[0].imported -ne 0 -and $env:CORE_IMPORT_ALLOW_UPSERT -ne "1") {
    throw "target core database is not empty; set CORE_IMPORT_ALLOW_UPSERT=1 only for a convergent retry"
  }
  $state = [pscustomobject]@{ database = $database; manifest_sha256 = $manifestHash; completed = @() }
  $state | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $statePath -Encoding UTF8
}

$completed = [System.Collections.Generic.HashSet[string]]::new()
@($state.completed) | ForEach-Object { $null = $completed.Add([string]$_) }
foreach ($file in $manifest.files) {
  if ($completed.Contains([string]$file.sha256)) { continue }
  $path = Join-Path $directory $file.file
  Write-Output (@{ importing = $file.file; bytes = $file.bytes } | ConvertTo-Json -Compress)
  Invoke-Wrangler -Arguments @("d1", "execute", $database, "--remote", "--yes", "--file", $path)
  $null = $completed.Add([string]$file.sha256)
  $state.completed = @($completed)
  $temporaryStatePath = "$statePath.tmp"
  $state | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $temporaryStatePath -Encoding UTF8
  Move-Item -LiteralPath $temporaryStatePath -Destination $statePath -Force
}

$readiness = @{}
Read-RemoteRows "SELECT key,value FROM core_state WHERE key IN ('build_complete','import_complete','seed_event_index','last_event_index')" |
  ForEach-Object { $readiness[[string]$_.key] = [string]$_.value }
if ($readiness.build_complete -ne "1" -or $readiness.import_complete -ne "1" -or -not $readiness.seed_event_index -or -not $readiness.last_event_index) {
  throw "remote core database did not complete the seed import"
}
Write-Output (@{ complete = $true; database = $database; files = @($manifest.files).Count; manifest_sha256 = $manifestHash } | ConvertTo-Json -Compress)
