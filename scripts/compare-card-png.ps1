# Compare the PNGs of two cdp-verify-xhs-cards.mjs runs, pixel by pixel.
#
# Usage:
#   pwsh scripts/compare-card-png.ps1 `
#     -Baseline verify-out/xhs/2026-10-31T07-09-19-913Z `
#     -Current  verify-out/xhs/<new-run>
#
# It walks every PNG and ZIP under exports/ in the baseline run, finds the same
# relative path in the current run, and compares the decoded pixels (RGB, alpha
# ignored). ZIP entries are compared by archive-relative path and entry name.
# Reed's baseline export must match exactly; any pixel difference is listed.
[CmdletBinding()]
param(
  [Parameter(Mandatory)] [string] $Baseline,
  [Parameter(Mandatory)] [string] $Current,
  [int] $MaxDiffs = 8
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.IO.Compression.FileSystem

$baselineRoot = (Resolve-Path -LiteralPath $Baseline).Path
$currentRoot = (Resolve-Path -LiteralPath $Current).Path
if ($baselineRoot -eq $currentRoot) { throw 'Baseline and current are the same run.' }
if (-not (Test-Path (Join-Path $baselineRoot 'exports'))) { throw "No exports/ in $baselineRoot" }
if (-not (Test-Path (Join-Path $currentRoot 'exports'))) { throw "No exports/ in $currentRoot" }

function Compare-Png {
  param([string] $A, [string] $B)
  $bmpA = [System.Drawing.Bitmap]::new($A)
  $bmpB = [System.Drawing.Bitmap]::new($B)
  try {
    if ($bmpA.Width -ne $bmpB.Width -or $bmpA.Height -ne $bmpB.Height) {
      return [pscustomobject]@{
        ok = $false; reason = "size $($bmpA.Width)x$($bmpA.Height) vs $($bmpB.Width)x$($bmpB.Height)"
        pixels = 0; maxDelta = 0; diffs = @()
      }
    }
    $w = $bmpA.Width; $h = $bmpA.Height
    $rect = [System.Drawing.Rectangle]::new(0, 0, $w, $h)
    $fmt = [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
    $mode = [System.Drawing.Imaging.ImageLockMode]::ReadOnly
    $lockA = $bmpA.LockBits($rect, $mode, $fmt)
    $lockB = $bmpB.LockBits($rect, $mode, $fmt)
    try {
      $bytesA = [byte[]]::new([Math]::Abs($lockA.Stride) * $h)
      $bytesB = [byte[]]::new([Math]::Abs($lockB.Stride) * $h)
      [System.Runtime.InteropServices.Marshal]::Copy($lockA.Scan0, $bytesA, 0, $bytesA.Length)
      [System.Runtime.InteropServices.Marshal]::Copy($lockB.Scan0, $bytesB, 0, $bytesB.Length)
      $strideA = [Math]::Abs($lockA.Stride)
      $strideB = [Math]::Abs($lockB.Stride)
      $diffs = [System.Collections.Generic.List[string]]::new()
      $count = 0; $maxDelta = 0
      for ($y = 0; $y -lt $h; $y++) {
        $rowA = $y * $strideA; $rowB = $y * $strideB
        for ($x = 0; $x -lt $w; $x++) {
          $ia = $rowA + $x * 4; $ib = $rowB + $x * 4
          $delta = [Math]::Max(
            [Math]::Abs([int]$bytesA[$ia] - [int]$bytesB[$ib]),
            [Math]::Max(
              [Math]::Abs([int]$bytesA[$ia + 1] - [int]$bytesB[$ib + 1]),
              [Math]::Abs([int]$bytesA[$ia + 2] - [int]$bytesB[$ib + 2])
            )
          )
          if ($delta -ne 0) {
            $count++
            if ($delta -gt $maxDelta) { $maxDelta = $delta }
            if ($diffs.Count -lt $MaxDiffs) { $diffs.Add("($x,$y) delta=$delta") }
          }
        }
      }
      return [pscustomobject]@{
        ok = ($count -eq 0); reason = ''; pixels = $count; maxDelta = $maxDelta; diffs = @($diffs)
      }
    } finally {
      $bmpA.UnlockBits($lockA); $bmpB.UnlockBits($lockB)
    }
  } finally {
    $bmpA.Dispose(); $bmpB.Dispose()
  }
}

$failures = 0
$compared = 0
$temp = Join-Path ([System.IO.Path]::GetTempPath()) ('reed-card-compare-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temp | Out-Null
try {
  $baselineFiles = Get-ChildItem -LiteralPath (Join-Path $baselineRoot 'exports') -Recurse -File | Where-Object { $_.Extension -in '.png', '.zip' }
  foreach ($file in $baselineFiles) {
    $relative = [System.IO.Path]::GetRelativePath($baselineRoot, $file.FullName)
    $currentFile = Join-Path $currentRoot $relative
    if (-not (Test-Path -LiteralPath $currentFile)) {
      Write-Output "MISSING $relative"; $failures++; continue
    }
    if ($file.Extension -eq '.png') {
      if ((Get-FileHash -Algorithm SHA256 -LiteralPath $file.FullName).Hash -eq
          (Get-FileHash -Algorithm SHA256 -LiteralPath $currentFile).Hash) {
        $compared++
        Write-Output "OK      $relative (identical bytes)"
        continue
      }
      $result = Compare-Png -A $file.FullName -B $currentFile
      $compared++
      if ($result.ok) { Write-Output "OK      $relative" }
      else {
        $failures++
        Write-Output "DIFF    $relative — $($result.pixels) px differ, max delta $($result.maxDelta), $($result.reason)"
        foreach ($d in $result.diffs) { Write-Output "         $d" }
      }
      continue
    }

    $zipA = [System.IO.Compression.ZipFile]::OpenRead($file.FullName)
    $zipB = [System.IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $currentFile).Path)
    try {
      $entryNamesA = @($zipA.Entries | Where-Object { -not $_.FullName.EndsWith('/') } | ForEach-Object FullName)
      $entryNamesB = @($zipB.Entries | Where-Object { -not $_.FullName.EndsWith('/') } | ForEach-Object FullName)
      if (($entryNamesA -join "`n") -ne ($entryNamesB -join "`n")) {
        $failures++
        Write-Output "DIFF    $relative — ZIP entry list differs ($($entryNamesA.Count) vs $($entryNamesB.Count))"
        continue
      }
      foreach ($name in $entryNamesA) {
        $entryA = $zipA.GetEntry($name); $entryB = $zipB.GetEntry($name)
        $safe = ($name -replace '[^A-Za-z0-9._-]', '_')
        $outA = Join-Path $temp ('a-' + $safe); $outB = Join-Path $temp ('b-' + $safe)
        [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entryA, $outA, $true)
        [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entryB, $outB, $true)
        $sameBytes = (Get-FileHash -Algorithm SHA256 -LiteralPath $outA).Hash -eq
          (Get-FileHash -Algorithm SHA256 -LiteralPath $outB).Hash
        $result = if ($sameBytes) { [pscustomobject]@{ ok = $true; pixels = 0; maxDelta = 0; reason = ''; diffs = @() } }
          else { Compare-Png -A $outA -B $outB }
        $compared++
        if ($result.ok) { Write-Output "OK      $relative#$name$(if ($sameBytes) { ' (identical bytes)' })" }
        else {
          $failures++
          Write-Output "DIFF    $relative#$name — $($result.pixels) px differ, max delta $($result.maxDelta), $($result.reason)"
          foreach ($d in $result.diffs) { Write-Output "         $d" }
        }
        Remove-Item -LiteralPath $outA, $outB -Force
      }
    } finally {
      $zipA.Dispose(); $zipB.Dispose()
    }
  }
} finally {
  Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Output ''
Write-Output "Compared $compared PNG images. $failures difference(s)."
if ($failures -gt 0) { exit 1 }