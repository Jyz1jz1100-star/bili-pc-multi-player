param(
  [string]$CacheAsar = "",                                   # default: current cache asar for the installed .version
  [string]$OutAsar = "",                                     # default: build/app.asar.patched
  [string]$ShimBundle = ""                                   # default: build/biliapp-shim.js
)
$ErrorActionPreference = "Stop"
$work = Split-Path $PSScriptRoot -Parent
$node = (Get-Command node -ErrorAction SilentlyContinue).Source; if (-not $node) { throw "Node.js not found in PATH (need node 18+)" }
$py = (Get-Command python -ErrorAction SilentlyContinue).Source; if (-not $py) { throw "Python not found in PATH (need python 3.8+)" }
$res = Join-Path $env:APPDATA "bilibili\resource"

if (-not $CacheAsar) {
  $pristine = Join-Path $work "backup\cache-asar.orig.asar"
  if (Test-Path $pristine) { Write-Host "using pristine backup asar"; $CacheAsar = $pristine }
}
if (-not $CacheAsar) {
  $ver = (Get-Content (Join-Path $res ".version") -Raw).Trim()
  $md5 = [System.BitConverter]::ToString([System.Security.Cryptography.MD5]::Create().ComputeHash([System.Text.Encoding]::UTF8.GetBytes($ver))).Replace("-","").ToLower()
  $CacheAsar = Join-Path $res ($md5.Substring(0,16) + ".asar")
  Write-Host "using installed cache asar for version $ver"
}
if (-not $OutAsar) { $OutAsar = Join-Path $work "build\app.asar.patched" }
if (-not $ShimBundle) { $ShimBundle = Join-Path $work "build\biliapp-shim.js" }

Write-Host "cache asar : $CacheAsar ($((Get-Item $CacheAsar).Length) bytes)"
Write-Host "shim bundle: $ShimBundle ($((Get-Item $ShimBundle).Length) bytes)"

$tmp = Join-Path $env:TEMP ("bili-asar-build-" + [guid]::NewGuid().ToString("N").Substring(0,8))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
try {
  Write-Host "=== unpack ==="
  & $py "$work\tools\asar.py" unpack $CacheAsar $tmp | Out-Null
  $biliapp = Join-Path $tmp "main\.biliapp"
  if (-not (Test-Path $biliapp)) { throw "main\.biliapp not found in $CacheAsar" }

  Write-Host "=== 1/2 main process: decrypt bundle, prepend shim, re-encrypt ==="
  $plain = Join-Path $tmp "main\.biliapp.plain.js"
  & $node "$work\tools\decrypt-gcm.cjs" $biliapp $plain | Write-Host
  $patchedPlain = Join-Path $tmp "main\.biliapp.patched.js"
  & $node "$work\tools\build-shim-bundle.cjs" $plain (Join-Path $work "tools\shim.js") $patchedPlain | Write-Host
  & $node "$work\tools\encrypt-gcm.cjs" $patchedPlain $biliapp | Write-Host
  Remove-Item $plain, $patchedPlain -Force -ErrorAction SilentlyContinue

  Write-Host "=== 2/2 renderer: stamp __realOpen on openPlayerWindow calls ==="
  $mainChunk = Join-Path $tmp "render\assets\index.ef2cf61c.js"
  if (Test-Path $mainChunk) {
    $outChunk = "$mainChunk.patched"
    & $node "$work\deobf\patch-renderer-marker.mjs" $mainChunk $outChunk | Write-Host
    if ($LASTEXITCODE -ne 0) { throw "renderer marker patch failed" }
    Move-Item $outChunk $mainChunk -Force
  } else {
    Write-Warning "renderer chunk index.ef2cf61c.js not found - hover/auto opens will not be discriminated (main-process part still applied)"
  }

  Write-Host "=== repack ==="
  & $py "$work\tools\asar.py" pack $tmp $OutAsar | Write-Host
  $count = (& $py "$work\tools\asar.py" list $OutAsar | Measure-Object -Line).Lines
  Write-Host "entries: $count"
  if ($count -lt 100) { throw "repack looks wrong (entries=$count)" }
  Write-Host "OK -> $OutAsar ($((Get-Item $OutAsar).Length) bytes)"
} finally {
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
