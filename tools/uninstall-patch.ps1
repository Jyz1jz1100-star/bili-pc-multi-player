param([switch]$NoLaunch)
$ErrorActionPreference = "Stop"
$work = Split-Path $PSScriptRoot -Parent
$res = Join-Path $env:APPDATA "bilibili\resource"
$backup = Join-Path $work "backup"

$orig = Join-Path $backup "cache-asar.orig.asar"
if (-not (Test-Path $orig)) {
  $any = Get-ChildItem $backup -Filter *.asar -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($any) { $orig = $any.FullName } else { throw "no original asar backup found in $backup (install-patch.ps1 creates it)" }
}

$ver = (Get-Content (Join-Path $res ".version") -Raw).Trim()
$md5 = [System.BitConverter]::ToString([System.Security.Cryptography.MD5]::Create().ComputeHash([System.Text.Encoding]::UTF8.GetBytes($ver))).Replace("-","").ToLower()
$target = Join-Path $res ($md5.Substring(0,16) + ".asar")

Write-Host "=== stop bilibili ==="
Get-Process | Where-Object { $_.ProcessName -match '哔哩' } | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3

Copy-Item $orig $target -Force
Remove-Item (Join-Path $res ".biliapp") -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $res ".bilijsc") -Force -ErrorAction SilentlyContinue
Write-Host "restored original cache asar: $target ($((Get-Item $target).Length) bytes)"
Write-Host "the client will rebuild resource\.biliapp from it on the next start (unpatched)"

if (-not $NoLaunch) {
  $appExe = (Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\BiliBili" -ErrorAction SilentlyContinue).UninstallString
  if ($appExe) { $appExe = Join-Path (Split-Path $appExe) "哔哩哔哩.exe" } else { $appExe = "C:\Program Files\bilibili\哔哩哔哩.exe" }
  Start-Process explorer.exe -ArgumentList "`"$appExe`""
  Start-Sleep -Seconds 25
  Write-Host "launched"
}
