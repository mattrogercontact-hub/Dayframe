param([switch]$DryRun)

$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$address = 'http://localhost:5173/'
$node = (Get-Command node -ErrorAction Stop).Source
$chrome = @(
  'C:\Program Files\Google\Chrome\Application\chrome.exe',
  'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',
  (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $chrome) { throw 'Google Chrome was not found on this computer.' }
$profile = Join-Path $project '.dayframe-private\chrome-profile'
$builtApp = Join-Path $project 'dist\index.html'

if ($DryRun) {
  [pscustomobject]@{ Project = $project; Node = $node; Chrome = $chrome; Profile = $profile; Address = $address }
  return
}
if (-not (Test-Path -LiteralPath $builtApp)) { throw 'Build Dayframe with npm run build before starting the kiosk.' }

function Test-DayframeServer {
  try {
    $response = Invoke-WebRequest -Uri $address -TimeoutSec 2 -UseBasicParsing
    return $response.StatusCode -eq 200 -and $response.Content -match 'Dayframe'
  } catch { return $false }
}

if (-not (Test-DayframeServer)) {
  Start-Process -FilePath $node -ArgumentList 'server/serve.mjs' -WorkingDirectory $project -WindowStyle Hidden
  for ($attempt = 0; $attempt -lt 30 -and -not (Test-DayframeServer); $attempt++) {
    Start-Sleep -Milliseconds 500
  }
}
if (-not (Test-DayframeServer)) { throw 'Dayframe did not start on localhost:5173.' }

New-Item -ItemType Directory -Path $profile -Force | Out-Null
Start-Process -FilePath $chrome -ArgumentList @("--user-data-dir=`"$profile`"", '--kiosk', '--no-first-run', $address)
