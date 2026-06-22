# Resize app screenshots to App Store Connect sizes (no distortion: scale to
# fit, then pad to the exact canvas with the app's light background colour).
#
# Usage:
#   1. Drop your PNG/JPG screenshots into  C:\TheCarPool\screenshots\
#   2. Run:  pwsh C:\TheCarPool\scripts\resize-screenshots.ps1
#   3. App-Store-ready files appear in  C:\TheCarPool\screenshots\appstore\
#
# Default target = 1284 x 2778 (iPhone 6.5"/6.7" slot). Change $TargetW/$TargetH
# for other sizes (e.g. iPad 12.9" = 2048 x 2732).

param(
  [string]$InDir   = "C:\TheCarPool\screenshots",
  [string]$OutDir  = "C:\TheCarPool\screenshots\appstore",
  [int]$TargetW    = 1284,
  [int]$TargetH    = 2778,
  [string]$BgHex   = "#FAFBFC"
)

Add-Type -AssemblyName System.Drawing

if (-not (Test-Path $InDir)) { New-Item -ItemType Directory -Force -Path $InDir | Out-Null; Write-Host "Created $InDir — drop screenshots there and re-run."; exit }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$bg = [System.Drawing.ColorTranslator]::FromHtml($BgHex)
$files = Get-ChildItem -Path $InDir -File | Where-Object { $_.Extension -match '\.(png|jpe?g)$' -and $_.DirectoryName -ne (Resolve-Path $OutDir).Path }

if (-not $files) { Write-Host "No images found in $InDir"; exit }

foreach ($f in $files) {
  $img = [System.Drawing.Image]::FromFile($f.FullName)
  try {
    # scale to fit inside target, preserving aspect
    $scale = [Math]::Min($TargetW / $img.Width, $TargetH / $img.Height)
    $w = [int]([Math]::Round($img.Width * $scale))
    $h = [int]([Math]::Round($img.Height * $scale))
    $x = [int](($TargetW - $w) / 2)
    $y = [int](($TargetH - $h) / 2)

    $canvas = New-Object System.Drawing.Bitmap($TargetW, $TargetH)
    $g = [System.Drawing.Graphics]::FromImage($canvas)
    $g.SmoothingMode = 'AntiAlias'
    $g.InterpolationMode = 'HighQualityBicubic'
    $g.Clear($bg)
    $g.DrawImage($img, $x, $y, $w, $h)
    $g.Dispose()

    $out = Join-Path $OutDir ("{0}_{1}x{2}.png" -f $f.BaseName, $TargetW, $TargetH)
    $canvas.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
    $canvas.Dispose()
    Write-Host "OK  $($f.Name)  ->  $out"
  } finally { $img.Dispose() }
}
Write-Host "Done. App-Store-ready screenshots in $OutDir ($TargetW x $TargetH)."
