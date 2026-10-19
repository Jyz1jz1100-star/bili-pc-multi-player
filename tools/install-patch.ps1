param(
  [string]$PatchedAsar = "",   # default build\app.asar.patched (built by rebuild-asar.ps1)
  [switch]$NoLaunch
)
$ErrorActionPreference = "Stop"
$work = Split-Path $PSScriptRoot -Parent
$res = Join-Path $env:APPDATA "bilibili\resource"
$backup = Join-Path $work "backup"

$ver = (Get-Content (Join-Path $res ".version") -Raw).Trim()
$md5 = [System.BitConverter]::ToString([System.Security.Cryptography.MD5]::Create().ComputeHash([System.Text.Encoding]::UTF8.GetBytes($ver))).Replace("-","").ToLower()
$cacheName = $md5.Substring(0,16) + ".asar"
$target = Join-Path $res $cacheName
if (-not $PatchedAsar) { $PatchedAsar = Join-Path $work "build\app.asar.patched" }
if (-not (Test-Path $PatchedAsar)) { throw "patched asar not found: $PatchedAsar (run rebuild-asar.ps1 first)" }

Write-Host "=== stop bilibili ==="
Get-Process | Where-Object { $_.ProcessName -match '哔哩' } | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3

Write-Host "=== backup originals (once) ==="
New-Item -ItemType Directory -Force -Path $backup | Out-Null
if (-not (Test-Path (Join-Path $backup "cache-asar.orig.asar"))) {
  Copy-Item $target (Join-Path $backup "cache-asar.orig.asar")
  Write-Host "backed up cache asar -> backup\cache-asar.orig.asar"
}
if (-not (Test-Path (Join-Path $backup "settings.json.orig"))) {
  $s = Join-Path $env:APPDATA "bilibili\settings.json"
  if (Test-Path $s) { Copy-Item $s (Join-Path $backup "settings.json.orig") }
}

Write-Host "=== install patched cache asar ==="
Copy-Item $PatchedAsar $target -Force
# force the launcher to re-derive resource\.biliapp + .bilijsc from the (patched) asar
Remove-Item (Join-Path $res ".biliapp") -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $res ".bilijsc") -Force -ErrorAction SilentlyContinue
Write-Host "installed: $target ($((Get-Item $target).Length) bytes)"

if (-not $NoLaunch) {
  Write-Host "=== launch (first boot regenerates the cache) ==="
  $appExe = (Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\BiliBili" -ErrorAction SilentlyContinue).UninstallString
  if ($appExe) { $appExe = Join-Path (Split-Path $appExe) "哔哩哔哩.exe" } else { $appExe = "C:\Program Files\bilibili\哔哩哔哩.exe" }
  Start-Process explorer.exe -ArgumentList "`"$appExe`""
  Start-Sleep -Seconds 28
  $fx = Join-Path $res ".biliapp"
  if (Test-Path $fx) { Write-Host ".biliapp regenerated: $((Get-Item $fx).Length) bytes" }
  $log = Join-Path $env:APPDATA "bilibili\logs\main.log"
  Get-Content $log -Tail 40 | Where-Object { $_ -match 'cache|Player window (created|ready)' } | Select-Object -Last 5
}
