<#
.SYNOPSIS
  由一张照片生成"整页/跨页背景"：裁切 → 高斯模糊 → 渐变遮罩 → 暗部提亮 → 自动对比度校准 → 切分左右页。
.DESCRIPTION
  自动校准是关键：脚本会给遮罩逐级加码，直到**全文区每个采样点**都达到正文对比度下限（默认 4.5:1），
  同时记录暗部是否还保留层次。这样就不需要"生成→量→手动调→再量"的反复试错。
  规格由参数给出（开本、出血、跨页、文字色、分辨率），可复用到任何单页/跨页成品。
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File make-background.ps1 -Source E:\图.jpg -OutDir E:\项目\_build `
    -PageCount 2 -PageWidthMm 185 -PageHeightMm 260 -BleedMm 3 -TextRgb "245,243,239"
#>
param(
  [Parameter(Mandatory = $true)][string]$Source,
  [Parameter(Mandatory = $true)][string]$OutDir,
  [int]$PageCount = 2,                  # 1 = 单页；2 = 跨页
  [double]$PageWidthMm = 185,
  [double]$PageHeightMm = 260,
  [double]$BleedMm = 3,
  [string]$TextRgb = '245,243,239',
  [double]$MinContrast = 4.5,
  [int]$Dpi = 300,
  [int]$BlurDivisor = 16,
  [int]$ScrimTop = 178,
  [int]$ScrimMid = 172,
  [int]$ScrimBottom = 72,
  [double]$ShadowGamma = 0.88,
  [int]$TopMm = 26, [int]$BottomMm = 250,   # 参与对比度校准的文字纵向范围
  [switch]$SkipCalibration
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$mm = 25.4 / $Dpi
$panW = [int][math]::Round(($PageWidthMm * $PageCount + $BleedMm * 2) / $mm)
$panH = [int][math]::Round(($PageHeightMm + $BleedMm * 2) / $mm)
$pageW = [int][math]::Round(($PageWidthMm + $BleedMm * 2) / $mm)
$tr = $TextRgb -split ',' | ForEach-Object { [int]$_.Trim() }

function Lin([double]$c) { $v = $c / 255.0; if ($v -le 0.03928) { return $v / 12.92 }; return [math]::Pow((($v + 0.055) / 1.055), 2.4) }
function Lum([int]$r, [int]$g, [int]$b) { return 0.2126 * (Lin $r) + 0.7152 * (Lin $g) + 0.0722 * (Lin $b) }
function Contrast([double]$l1, [double]$l2) { $a = [math]::Max($l1, $l2); $b = [math]::Min($l1, $l2); return ($a + 0.05) / ($b + 0.05) }

# 生成一版背景，返回左右页位图与全景
function Build-Panorama($topA, $midA, $botA) {
  $src = [System.Drawing.Image]::FromFile($Source)
  try {
    $scale = [math]::Max($panW / $src.Width, $panH / $src.Height)
    $sw = [int][math]::Round($src.Width * $scale); $sh = [int][math]::Round($src.Height * $scale)
    $pan = [System.Drawing.Bitmap]::new($panW, $panH); $pan.SetResolution($Dpi, $Dpi)
    $g = [System.Drawing.Graphics]::FromImage($pan)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.DrawImage($src, [System.Drawing.Rectangle]::new([int](-(($sw - $panW) / 2)), [int](-(($sh - $panH) / 2)), $sw, $sh))
    $g.Dispose()
  } finally { $src.Dispose() }

  $smallW = [Math]::Max(2, [int]($panW / $BlurDivisor)); $smallH = [Math]::Max(2, [int]($panH / $BlurDivisor))
  $small = [System.Drawing.Bitmap]::new($smallW, $smallH)
  $gs = [System.Drawing.Graphics]::FromImage($small)
  $gs.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $gs.DrawImage($pan, [System.Drawing.Rectangle]::new(0, 0, $smallW, $smallH)); $gs.Dispose(); $pan.Dispose()

  $blur = [System.Drawing.Bitmap]::new($panW, $panH); $blur.SetResolution($Dpi, $Dpi)
  $gb = [System.Drawing.Graphics]::FromImage($blur)
  $gb.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $gb.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $ia = New-Object System.Drawing.Imaging.ImageAttributes
  $ia.SetWrapMode([System.Drawing.Drawing2D.WrapMode]::TileFlipXY)
  $gb.DrawImage($small, [System.Drawing.Rectangle]::new(0, 0, $panW, $panH), 0, 0, $smallW, $smallH, [System.Drawing.GraphicsUnit]::Pixel, $ia)
  $gb.Dispose(); $small.Dispose(); $ia.Dispose()

  # 遮罩（顶部重 → 中段 → 底部轻；方向与照片明暗相反）
  $gc = [System.Drawing.Graphics]::FromImage($blur)
  $rectFull = [System.Drawing.Rectangle]::new(0, 0, $panW, $panH)
  $lg = [System.Drawing.Drawing2D.LinearGradientBrush]::new($rectFull, [System.Drawing.Color]::FromArgb($topA, 6, 8, 12), [System.Drawing.Color]::FromArgb($botA, 6, 8, 12), [single]90.0)
  $blend = [System.Drawing.Drawing2D.ColorBlend]::new(3)
  $blend.Colors = @([System.Drawing.Color]::FromArgb($topA, 6, 8, 12), [System.Drawing.Color]::FromArgb($midA, 6, 8, 12), [System.Drawing.Color]::FromArgb($botA, 6, 8, 12))
  $blend.Positions = @(0.0, 0.35, 1.0)
  $lg.InterpolationColors = $blend
  $gc.FillRectangle($lg, $rectFull); $lg.Dispose(); $gc.Dispose()

  # 暗部提亮
  if ($ShadowGamma -ne 1.0) {
    $lifted = [System.Drawing.Bitmap]::new($panW, $panH); $lifted.SetResolution($Dpi, $Dpi)
    $gl = [System.Drawing.Graphics]::FromImage($lifted)
    $gl.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $attr = New-Object System.Drawing.Imaging.ImageAttributes
    $attr.SetGamma([single]$ShadowGamma)
    $gl.DrawImage($blur, [System.Drawing.Rectangle]::new(0, 0, $panW, $panH), 0, 0, $panW, $panH, [System.Drawing.GraphicsUnit]::Pixel, $attr)
    $gl.Dispose(); $attr.Dispose(); $blur.Dispose(); $blur = $lifted
  }
  return $blur
}

# 用 LockBits 快速统计对比度与暗部层次
function Measure-Bitmap($bmp) {
  $w = $bmp.Width; $h = $bmp.Height
  $rect = [System.Drawing.Rectangle]::new(0, 0, $w, $h)
  $data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $stride = $data.Stride
  $bytes = New-Object byte[] ($stride * $h)
  [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)
  $bmp.UnlockBits($data)

  $textLum = Lum $tr[0] $tr[1] $tr[2]
  $y0 = [int]($TopMm / $mm); $y1 = [int]($BottomMm / $mm)
  $step = [Math]::Max(1, [int]($w / 400))
  $below = 0; $n = 0; $worst = 99.0
  for ($y = $y0; $y -lt $y1; $y += $step) {
    $rowoff = $y * $stride
    for ($x = 0; $x -lt $w; $x += $step) {
      $i = $rowoff + $x * 3
      $c = Contrast $textLum (Lum $bytes[$i + 2] $bytes[$i + 1] $bytes[$i])
      $n++
      if ($c -lt $worst) { $worst = $c }
      if ($c -lt $MinContrast) { $below++ }
    }
  }
  return @{ Worst = [math]::Round($worst, 2); Below = $below; N = $n }
}

Write-Output "目标背景：$([math]::Round($PageWidthMm * $PageCount + $BleedMm * 2))×$([math]::Round($PageHeightMm + $BleedMm * 2))mm @$Dpi dpi = $panW×$panH px"

$topA = $ScrimTop; $midA = $ScrimMid; $botA = $ScrimBottom
$pan = Build-Panorama $topA $midA $botA
$meas = Measure-Bitmap $pan
Write-Output ("初版遮罩（{0}/{1}/{2}）：最差对比度 {3}:1，低于 {4}:1 的采样点 {5}/{6}" -f $topA, $midA, $botA, $meas.Worst, $MinContrast, $meas.Below, $meas.N)

if (-not $SkipCalibration) {
  $round = 0
  while ($meas.Below -gt 0 -and $midA -lt 240 -and $round -lt 8) {
    $topA = [Math]::Min(250, $topA + 10)
    $midA = [Math]::Min(250, $midA + 10)
    $round++
    $pan.Dispose()
    $pan = Build-Panorama $topA $midA $botA
    $meas = Measure-Bitmap $pan
    Write-Output ("  校准第 {0} 轮（{1}/{2}/{3}）：最差 {4}:1，不达标 {5}/{6}" -f $round, $topA, $midA, $botA, $meas.Worst, $meas.Below, $meas.N)
  }
  if ($meas.Below -eq 0) { Write-Output "自动校准完成：遮罩 $topA/$midA/$botA 达标（最差 $($meas.Worst):1）" }
  else { Write-Output "★ 校准到上限仍未达标（最差 $($meas.Worst):1）——建议换更暗的底图或改用浅底深字" }
}

# 暗部层次检查（避免压成平黑）
$rectFull = [System.Drawing.Rectangle]::new(0, 0, $panW, $panH)
$data = $pan.LockBits($rectFull, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
$stride = $data.Stride; $bytes = New-Object byte[] ($stride * $panH)
[System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length); $pan.UnlockBits($data)
$lums = @()
for ($y = [int](($PageHeightMm * 0.6) / $mm); $y -lt [int]($BottomMm / $mm); $y += [Math]::Max(1, [int]($panH / 200))) {
  $rowoff = $y * $stride
  for ($x = 0; $x -lt $panW; $x += [Math]::Max(1, [int]($panW / 200))) {
    $i = $rowoff + $x * 3
    $lums += (0.299 * $bytes[$i + 2] + 0.587 * $bytes[$i + 1] + 0.114 * $bytes[$i])
  }
}
$sorted = $lums | Sort-Object
Write-Output ("下半幅暗部：中位亮度 {0}，95 分位 {1}（太低会看不出画面内容）" -f [int]$sorted[[int]($sorted.Count / 2)], [int]$sorted[[int]($sorted.Count * 0.95)])

# 保存：全景 + 左右页
$enc = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$ep = New-Object System.Drawing.Imaging.EncoderParameters 1
$ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), 92
$pan.Save((Join-Path $OutDir 'bg-panorama.jpg'), $enc, $ep)
for ($k = 0; $k -lt $PageCount; $k++) {
  $bmp = [System.Drawing.Bitmap]::new($pageW, $panH); $bmp.SetResolution($Dpi, $Dpi)
  $gg = [System.Drawing.Graphics]::FromImage($bmp)
  $gg.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $x0 = [int]($k * $PageWidthMm / $mm)
  $gg.DrawImage($pan, [System.Drawing.Rectangle]::new(0, 0, $pageW, $panH), $x0, 0, $pageW, $panH, [System.Drawing.GraphicsUnit]::Pixel)
  $gg.Dispose()
  $name = if ($PageCount -eq 1) { 'bg-page.jpg' } elseif ($k -eq 0) { 'bg-left.jpg' } else { 'bg-right.jpg' }
  $bmp.Save((Join-Path $OutDir $name), $enc, $ep)
  $bmp.Dispose()
  Write-Output ("  已存 $name（{0}×{1}px）" -f $pageW, $panH)
}
$ep.Dispose(); $pan.Dispose()
Write-Output '背景生成完成'
