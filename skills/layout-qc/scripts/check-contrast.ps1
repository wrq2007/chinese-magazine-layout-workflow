<#
.SYNOPSIS
  检查"文字压在图片上"的对比度：给定背景图与文字颜色，按 WCAG 相对亮度算对比度，报告最差区域。
.DESCRIPTION
  用于带图背景的文字版面（封面、序言、图版配文）。印刷文字建议：
  正文 ≥ 4.5:1，大标题（≥18pt 或 ≥14pt 粗体）≥ 3:1；低于此值时开印会"糊"。
  只读操作。

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File check-contrast.ps1 -Path bg-left.jpg -TextRgb "245,243,239" -FromTopMm 26 -ToBottomMm 250
#>
param(
  [Parameter(Mandatory = $true)][string]$Path,
  [string]$TextRgb = '245,243,239',
  [double]$FromTopMm = 0,
  [double]$ToBottomMm = 0,
  [double]$StepMm = 4,
  [double]$MinBody = 4.5,
  [double]$MinLarge = 3.0
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

function Lin([double]$c) {
  $v = $c / 255.0
  if ($v -le 0.03928) { return $v / 12.92 }
  return [math]::Pow((($v + 0.055) / 1.055), 2.4)
}
function Lum([int]$r, [int]$g, [int]$b) { return 0.2126 * (Lin $r) + 0.7152 * (Lin $g) + 0.0722 * (Lin $b) }
function Contrast([double]$l1, [double]$l2) {
  $a = [math]::Max($l1, $l2); $b = [math]::Min($l1, $l2)
  return ($a + 0.05) / ($b + 0.05)
}

$resolved = (Resolve-Path -LiteralPath $Path).Path
$bmp = [System.Drawing.Bitmap]::FromFile($resolved)
try {
  $dpi = [double]$bmp.HorizontalResolution; if ($dpi -le 1) { $dpi = 300 }
  $mmPerPx = 25.4 / $dpi
  $w = $bmp.Width; $h = $bmp.Height
  $tr = $TextRgb -split ',' | ForEach-Object { [int]$_.Trim() }
  $textLum = Lum $tr[0] $tr[1] $tr[2]

  $y0 = if ($FromTopMm -gt 0) { [int]($FromTopMm / $mmPerPx) } else { 0 }
  $y1 = if ($ToBottomMm -gt 0) { [int]($ToBottomMm / $mmPerPx) } else { $h - 1 }
  $step = [Math]::Max(1, [int]($StepMm / $mmPerPx))

  $ratios = @()
  $worst = $null
  for ($y = $y0; $y -lt $y1; $y += $step) {
    for ($x = 0; $x -lt $w; $x += $step) {
      $c = $bmp.GetPixel($x, $y)
      $r = Contrast $textLum (Lum $c.R $c.G $c.B)
      $ratios += $r
      if ($worst -eq $null -or $r -lt $worst.R) { $worst = [pscustomobject]@{ R = $r; X = [math]::Round($x * $mmPerPx, 1); Y = [math]::Round($y * $mmPerPx, 1); RGB = "$($c.R),$($c.G),$($c.B)" } }
    }
  }
  $sorted = $ratios | Sort-Object
  $belowBody = ($ratios | Where-Object { $_ -lt $MinBody }).Count
  $belowLarge = ($ratios | Where-Object { $_ -lt $MinLarge }).Count

  "=== 对比度检查 ==="
  "背景图 : $resolved  ($([math]::Round($w * $mmPerPx,1)) x $([math]::Round($h * $mmPerPx,1)) mm @ $([math]::Round($dpi,0)) dpi)"
  "文字色 : rgb($TextRgb)"
  "取样区 : 顶部 $FromTopMm mm → 底部 $(if ($ToBottomMm -gt 0) { $ToBottomMm } else { [math]::Round($h * $mmPerPx,1) }) mm，步长 $StepMm mm，共 $($ratios.Count) 个采样点"
  ""
  "最差 : $([math]::Round($worst.R,2)):1  位置 ($($worst.X)mm, $($worst.Y)mm)  背景 rgb($($worst.RGB))"
  "中位 : $([math]::Round($sorted[[int]($sorted.Count / 2)],2)):1"
  "10 分位 : $([math]::Round($sorted[[int]($sorted.Count * 0.1)],2)):1"
  "低于正文底线 $($MinBody):1 的采样点 : $belowBody / $($ratios.Count)  ($([math]::Round(100 * $belowBody / $ratios.Count,1))%)"
  "低于大标题底线 $($MinLarge):1 的采样点 : $belowLarge / $($ratios.Count)  ($([math]::Round(100 * $belowLarge / $ratios.Count,1))%)"
  ""
  if ($belowBody -eq 0) { "判定 : ok —— 全文区都满足正文对比度" }
  elseif ($belowLarge -eq 0) { "判定 : 仅够大标题 —— 大字号可用，小字区域需再加遮罩" }
  else { "判定 : ★ 不足 —— 小字也会糊，必须加强遮罩或换文字色" }
}
finally { $bmp.Dispose() }
