<#
.SYNOPSIS
  排版成品导出件量测：像素尺寸 / DPI / 反推物理尺寸 / 主色调 / 全宽色带 / 亮色文字带包围盒。

.DESCRIPTION
  用于交付前的客观质检。所有几何量都以像素扫描得到，并用 DPI 换算成毫米，
  以便与排版软件里设定的目标尺寸直接比对。
  只读操作，不修改任何文件。

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File measure-export.ps1 -Path .\poster.jpg -ExpectedWidthMm 297 -ExpectedHeightMm 420
#>
param(
  [Parameter(Mandatory = $true)][string]$Path,
  [double]$ExpectedWidthMm = 0,
  [double]$ExpectedHeightMm = 0,
  [int]$TopColors = 8,
  [int]$BrightThreshold = 215,
  [int]$ColorTolerance = 12,
  [int]$MaxTextBands = 14,
  [int]$MaxBands = 16
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$resolved = (Resolve-Path -LiteralPath $Path).Path
$file = Get-Item -LiteralPath $resolved
$bmp = [System.Drawing.Bitmap]::FromFile($resolved)

try {
  $w = $bmp.Width; $h = $bmp.Height
  $dpiX = [double]$bmp.HorizontalResolution; $dpiY = [double]$bmp.VerticalResolution
  if ($dpiX -le 1) { $dpiX = 72 }; if ($dpiY -le 1) { $dpiY = 72 }
  $mmPerPxX = 25.4 / $dpiX; $mmPerPxY = 25.4 / $dpiY
  $wMm = $w * $mmPerPxX; $hMm = $h * $mmPerPxY

  function Mm([double]$px, [double]$per) { [math]::Round($px * $per, 1) }

  "=== 文件 ==="
  "路径   : $resolved"
  "大小   : $([math]::Round($file.Length / 1MB, 2)) MB"
  "像素   : $w x $h"
  "DPI    : $([math]::Round($dpiX,1)) x $([math]::Round($dpiY,1))"
  "物理尺寸(按DPI反推): $([math]::Round($wMm,1)) x $([math]::Round($hMm,1)) mm"

  if ($ExpectedWidthMm -gt 0 -and $ExpectedHeightMm -gt 0) {
    $dw = 100 * ($wMm - $ExpectedWidthMm) / $ExpectedWidthMm
    $dh = 100 * ($hMm - $ExpectedHeightMm) / $ExpectedHeightMm
    "目标尺寸: $ExpectedWidthMm x $ExpectedHeightMm mm"
    "偏差    : 宽 $([math]::Round($dw,1))% / 高 $([math]::Round($dh,1))%"
    if ([math]::Abs($dw) -gt 2 -or [math]::Abs($dh) -gt 2) {
      "判定    : 尺寸不匹配 —— 优先怀疑页面单位错误（见 references/indesign-pitfalls.md）或导出分辨率被换算过"
    } else {
      "判定    : 尺寸匹配"
    }
  }

  # 采样步长：控制耗时，同时保证精度够用
  $stepX = [Math]::Max(1, [int]($w / 900))
  $stepY = [Math]::Max(1, [int]($h / 900))

  "`n=== 主色调（量化采样，仅取前 $TopColors） ==="
  $counts = @{}
  for ($y = 0; $y -lt $h; $y += $stepY) {
    for ($x = 0; $x -lt $w; $x += $stepX) {
      $c = $bmp.GetPixel($x, $y)
      $key = "$([math]::Floor($c.R/32)*32),$([math]::Floor($c.G/32)*32),$([math]::Floor($c.B/32)*32)"
      if ($counts.ContainsKey($key)) { $counts[$key]++ } else { $counts[$key] = 1 }
    }
  }
  $total = ($counts.Values | Measure-Object -Sum).Sum
  $counts.GetEnumerator() | Sort-Object Value -Descending | Select-Object -First $TopColors | ForEach-Object {
    $parts = $_.Key -split ','
    "  rgb($($_.Key))  $([math]::Round(100*$_.Value/$total,1))%"
  }

  # 全宽纯色带：左右边缘与中段颜色一致，说明该行是整幅通栏的纯色块
  "`n=== 全宽色带（连续区间） ==="
  $xs = @([int]($w*0.01), [int]($w*0.25), [int]($w*0.5), [int]($w*0.75), [int]($w*0.99))
  $bandStart = -1; $bandColor = $null; $bands = @(); $curColor = $null
  function SameRow($bmp, $xs, $y, $tol) {
    $c0 = $bmp.GetPixel($xs[0], $y)
    foreach ($x in $xs) {
      $c = $bmp.GetPixel($x, $y)
      if ([math]::Abs($c.R - $c0.R) -gt $tol -or [math]::Abs($c.G - $c0.G) -gt $tol -or [math]::Abs($c.B - $c0.B) -gt $tol) { return $null }
    }
    return $c0
  }
  for ($y = 0; $y -lt $h; $y++) {
    $c = SameRow $bmp $xs $y $ColorTolerance
    if ($c) {
      if ($bandStart -lt 0) {
        $bandStart = $y; $curColor = $c; $bandColor = "$($c.R),$($c.G),$($c.B)"
      }
      elseif ([math]::Abs($c.R - $curColor.R) -gt $ColorTolerance -or [math]::Abs($c.G - $curColor.G) -gt $ColorTolerance -or [math]::Abs($c.B - $curColor.B) -gt $ColorTolerance) {
        if (($y - $bandStart) -ge 2) { $bands += [pscustomobject]@{ Start = $bandStart; End = $y - 1; Color = $bandColor } }
        $bandStart = $y; $curColor = $c; $bandColor = "$($c.R),$($c.G),$($c.B)"
      }
    }
    else {
      if ($bandStart -ge 0) {
        if (($y - $bandStart) -ge 2) { $bands += [pscustomobject]@{ Start = $bandStart; End = $y - 1; Color = $bandColor } }
        $bandStart = -1
      }
    }
  }
  if ($bandStart -ge 0) { $bands += [pscustomobject]@{ Start = $bandStart; End = $h - 1; Color = $bandColor } }
  if ($bands.Count -eq 0) { "  （未检测到通栏纯色带：版面可能由图片/渐变主导）" }
  $bands | Select-Object -First $MaxBands | ForEach-Object {
    "  y $($_.Start)–$($_.End) px  =  $([math]::Round($_.Start*$mmPerPxY,0))–$([math]::Round(($_.End+1)*$mmPerPxY,0)) mm  rgb($($_.Color))"
  }

  # 亮色文字带：逐行统计亮像素，聚合成文字行区间，给出每行的横向范围与字高
  "`n=== 亮色文字带（阈值 >$BrightThreshold） ==="
  $brightRows = New-Object 'System.Collections.Generic.List[object]'
  for ($y = 0; $y -lt $h; $y++) {
    $cnt = 0; $minX = $w; $maxX = -1
    for ($x = 0; $x -lt $w; $x += $stepX) {
      $c = $bmp.GetPixel($x, $y)
      if ($c.R -gt $BrightThreshold -and $c.G -gt $BrightThreshold -and $c.B -gt $BrightThreshold) {
        $cnt++
        if ($x -lt $minX) { $minX = $x }
        if ($x -gt $maxX) { $maxX = $x }
      }
    }
    if ($cnt -ge 2) { $brightRows.Add([pscustomobject]@{ Y = $y; MinX = $minX; MaxX = $maxX }) }
  }
  if ($brightRows.Count -eq 0) { "  （未检测到亮色文字）" }
  else {
    $groups = @(); $cur = @($brightRows[0])
    for ($i = 1; $i -lt $brightRows.Count; $i++) {
      if ($brightRows[$i].Y - $brightRows[$i-1].Y -le 6) { $cur += $brightRows[$i] }
      else { $groups += ,$cur; $cur = @($brightRows[$i]) }
    }
    $groups += ,$cur
    $groups | Sort-Object { -($_ | Measure-Object -Property Y -Maximum).Maximum } | Select-Object -First $MaxTextBands | Sort-Object { ($_ | Measure-Object -Property Y -Minimum).Minimum } | ForEach-Object {
      $y0 = ($_ | Measure-Object -Property Y -Minimum).Minimum
      $y1 = ($_ | Measure-Object -Property Y -Maximum).Maximum
      $x0 = ($_ | Measure-Object -Property MinX -Minimum).Minimum
      $x1 = ($_ | Measure-Object -Property MaxX -Maximum).Maximum
      $gh = [math]::Round(($y1 - $y0 + 1) * $mmPerPxY, 1)
      "  y $y0–$y1 px = $([math]::Round($y0*$mmPerPxY,0))–$([math]::Round(($y1+1)*$mmPerPxY,0)) mm | x $([math]::Round($x0*$mmPerPxX,0))–$([math]::Round(($x1+1)*$mmPerPxX,0)) mm | 字高约 $gh mm"
    }
  }

  "`n=== 边缘留白 ==="
  "  左/右边界: $([math]::Round(($brightRows | Measure-Object -Property MinX -Minimum).Minimum * $mmPerPxX,1)) mm / " +
  "$([math]::Round(($w - 1 - ($brightRows | Measure-Object -Property MaxX -Maximum).Maximum) * $mmPerPxX,1)) mm"
}
finally {
  $bmp.Dispose()
}
