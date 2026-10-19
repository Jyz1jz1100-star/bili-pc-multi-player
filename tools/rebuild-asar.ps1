param(
  [string]$CacheAsar = "",                                   # default: pristine backup if present, else the installed cache asar
  [string]$OutAsar = ""                                      # default: build/app.asar.patched
)
$ErrorActionPreference = "Stop"
$work = Split-Path $PSScriptRoot -Parent
$node = (Get-Command node -ErrorAction SilentlyContinue).Source; if (-not $node) { throw "Node.js not found in PATH (need node 18+)" }
$py = (Get-Command python -ErrorAction SilentlyContinue).Source; if (-not $py) { throw "Python not found in PATH (need python 3.8+)" }
$res = Join-Path $env:APPDATA "bilibili\resource"

# pick the input asar: always prefer the pristine backup, so re-running never stacks the patch
if (-not $CacheAsar) {
  $pristine = Join-Path $work "backup\cache-asar.orig.asar"
  if (Test-Path $pristine) { $CacheAsar = $pristine; Write-Host "input: pristine backup asar" }
}
if (-not $CacheAsar) {
  $verFile = Join-Path $res ".version"
  if (-not (Test-Path $verFile)) { throw "bilibili client not found (no $verFile). Install/launch it once first." }
  $ver = (Get-Content $verFile -Raw).Trim()
  $md5 = [System.BitConverter]::ToString([System.Security.Cryptography.MD5]::Create().ComputeHash([System.Text.Encoding]::UTF8.GetBytes($ver))).Replace("-","").ToLower()
  $CacheAsar = Join-Path $res ($md5.Substring(0,16) + ".asar")
  Write-Host "input: installed cache asar for version $ver"
}
if (-not $OutAsar) { $OutAsar = Join-Path $work "build\app.asar.patched" }
Write-Host "cache asar: $CacheAsar ($((Get-Item $CacheAsar).Length) bytes)"

$tmp = Join-Path $env:TEMP ("bili-asar-build-" + [guid]::NewGuid().ToString("N").Substring(0,8))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
try {
  Write-Host "=== unpack ==="
  & $py "$work\tools\asar.py" unpack $CacheAsar $tmp | Out-Null
  $biliapp = Join-Path $tmp "main\.biliapp"
  if (-not (Test-Path $biliapp)) { throw "main\.biliapp not found in $CacheAsar (unsupported client version?)" }

  Write-Host "=== main process: decrypt, prepend shim, re-encrypt ==="
  $plain = Join-Path $tmp "main\.biliapp.plain.js"
  & $node "$work\tools\decrypt-gcm.cjs" $biliapp $plain | Write-Host
  if ((Get-Content $plain -Raw) -match 'bili-multiplayer patch') {
    throw "input asar is already patched. Pass -CacheAsar <pristine asar> (backup\cache-asar.orig.asar) or run tools\uninstall-patch.ps1 first."
  }
  $patchedPlain = Join-Path $tmp "main\.biliapp.patched.js"
  & $node "$work\tools\build-shim-bundle.cjs" $plain (Join-Path $work "tools\shim.js") $patchedPlain | Write-Host
  & $node "$work\tools\encrypt-gcm.cjs" $patchedPlain $biliapp | Write-Host
  Remove-Item $plain, $patchedPlain -Force -ErrorAction SilentlyContinue

  Write-Host "=== renderer: stamp __realOpen on openPlayerWindow calls ==="
  # find the Vite chunk that defines the bridge sender (name changes between versions)
  $chunk = $null
  $assets = Join-Path $tmp "render\assets"
  if (Test-Path $assets) {
    foreach ($f in Get-ChildItem $assets -Filter *.js) {
      $txt = Get-Content $f.FullName -Raw
      if ($txt -match '"./index\.' ) { continue }
      if ($txt -match 'window/openPlayerWindow' -and $txt -match '=>[A-Za-z0-9_$]+\("window/openPlayerWindow"') { $chunk = $f; break }
    }
  }
  if (-not $chunk) { $cand = Join-Path $assets "index.ef2cf61c.js"; if (Test-Path $cand) { $chunk = Get-Item $cand } }
  if ($chunk) {
    $outChunk = "$($chunk.FullName).patched"
    & $node "$work\deobf\patch-renderer-marker.mjs" $chunk.FullName $outChunk | Write-Host
    if ($LASTEXITCODE -ne 0) { throw "renderer marker patch failed for $($chunk.Name)" }
    Move-Item $outChunk $chunk.FullName -Force
  } else {
    Write-Warning "renderer bridge chunk not found - hover/auto opens will not be discriminated (main-process part still applied)"
  }

  Write-Host "=== repack ==="
  New-Item -ItemType Directory -Force -Path (Split-Path $OutAsar) | Out-Null
  & $py "$work\tools\asar.py" pack $tmp $OutAsar | Write-Host
  $count = (& $py "$work\tools\asar.py" list $OutAsar | Measure-Object -Line).Lines
  Write-Host "entries: $count"
  if ($count -lt 100) { throw "repack looks wrong (entries=$count)" }
  Write-Host "OK -> $OutAsar ($((Get-Item $OutAsar).Length) bytes)"
} finally {
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
