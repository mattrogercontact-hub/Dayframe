param([switch]$DryRun)

$ErrorActionPreference = 'Stop'
$taskName = 'Dayframe Kiosk'
$launcher = Join-Path $PSScriptRoot 'start-kiosk.ps1'
$powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$launcher`""

if ($DryRun) {
  [pscustomobject]@{ TaskName = $taskName; User = $user; Program = $powershell; Arguments = $arguments; Trigger = 'At user logon' }
  return
}

if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
  throw "A task named '$taskName' already exists. No changes were made."
}
$action = New-ScheduledTaskAction -Execute $powershell -Argument $arguments
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $taskName -Description 'Starts the local Dayframe server and opens Chrome in kiosk mode at sign-in.' -Action $action -Trigger $trigger -Principal $principal | Out-Null
