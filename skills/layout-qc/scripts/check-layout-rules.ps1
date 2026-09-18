<#
.SYNOPSIS
  从导出的成品图反向核对版面规则：栏数、栏宽、栏距、正文行高（推算字号）、文本区左右边界。

.DESCRIPTION
  把背景色当纸，凡是明显偏离背景的像素算作墨迹，再分别做行/列投影，从墨迹分布反推版面参数。
  性能：一次性把像素读进内存数组（LockBits），比逐点 GetPixel 快两个数量级。
  限制：**满版底色/满版图的页面不适用**（整页都是"墨迹"，会得到一个假的"单栏"结果）；
        这类页面请改用 InDesign 侧量文本框几何（build 脚本里的自查段落）。
  只读操作，不修改任何文件。

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File check-layout-rules.ps1 -Path page5.jpg `
    -MarginLeftMm 18 -Columns 3 -GutterMm 5 -ColumnWidthMm 56
#>
param(
  [Parameter(Mandatory = $true)][string]$Path,
  [double]$MarginLeftMm = -1,
  [double]$MarginRightMm = -1,
  [double]$MarginTopMm = -1,
  [double]$MarginBottomMm = -1,
  [int]$Columns = 0,
  [double]$GutterMm = -1,
  [double]$ColumnWidthMm = -1,
  [double]$ToleranceMm = 1.5,
  [int]$InkThreshold = 45,
  [double]$TextBlockLeftMm = -1,
  [switch]$CheckInkMargins,
  [int]$SampleStep = 0          # 0 = 自适应（每约 800 列采样一次）
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$resolved = (Resolve-Path -LiteralPath $Path).Path
$src = [System.Drawing.Bitmap]::FromFile($resolved)

try {
  # 统一成 24bpp，便于 LockBits 直接寻址
  $w = $src.Width; $h = $src.Height
  $dpi = [double]$src.HorizontalResolution; if ($dpi -le 1) { $dpi = 300 }
  $mmPerPx = 25.4 / $dpi
  function Mm([double]$px) { return [math]::Round($px * $mmPerPx, 1) }

  $bmp = [System.Drawing.Bitmap]::new($w, $h, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $bmp.SetResolution($dpi, $dpi)
  $g0 = [System.Drawing.Graphics]::FromImage($bmp)
  $g0.DrawImage($src, 0, 0, $w, $h)
  $g0.Dispose()

  $rect = [System.Drawing.Rectangle]::new(0, 0, $w, $h)
  $data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $stride = $data.Stride
  $bytes = New-Object byte[] ($stride * $h)
  [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)
  $bmp.UnlockBits($data)
  $bmp.Dispose()
  # 之后所有取色都走 $bytes：index = y*stride + x*3，顺序为 B,G,R

  $step = $SampleStep
  if ($step -le 0) { $step = [Math]::Max(1, [int]($w / 800)) }

  # 背景色：四角与上边中点的众数
  $samples = @()
  foreach ($pt in @(@(2, 2), @($w - 3, 2), @(2, $h - 3), @($w - 3, $h - 3), @([int]($w / 2), 2))) {
    $i = $pt[1] * $stride + $pt[0] * 3
    $samples += ('{0},{1},{2}' -f $bytes[$i + 2], $bytes[$i + 1], $bytes[$i])
  }
  $bgName = $samples | Group-Object | Sort-Object Count -Descending | Select-Object -First 1 | ForEach-Object { $_.Name }
  $bgc = $bgName -split ',' | ForEach-Object { [int]$_ }
  $bgIsWhite = ($bgc[0] -ge 235 -and $bgc[1] -ge 235 -and $bgc[2] -ge 235)

  "=== 文件 ==="
  "路径 : $resolved"
  "像素 : $w x $h  ($([math]::Round($dpi,0)) dpi → $([math]::Round($w * $mmPerPx,1)) x $([math]::Round($h * $mmPerPx,1)) mm)"
  "背景 : rgb($($bgc -join ','))$(if ($bgIsWhite) { '（白底，适合本检查）' } else { '（非白底）' })"
  "采样 : 步长 $step px"
  ""

  if (-not $bgIsWhite) {
    "判定 : 本页不是白底（满版底色或满版图）——基于墨迹的版心/栏位量测在本页不成立，"
    "       会得到「整页一个栏」的假结果。请改用 InDesign 侧量文本框几何（build 脚本里的自查段落）。"
    return
  }

  $rowInk = New-Object int[] $h
  $colInk = New-Object int[] $w
  $inkTotal = 0
  for ($y = 0; $y -lt $h; $y += $step) {
    $rowoff = $y * $stride
    for ($x = 0; $x -lt $w; $x += $step) {
      $i = $rowoff + $x * 3
      if ([math]::Abs($bytes[$i + 2] - $bgc[0]) -gt $InkThreshold -or
          [math]::Abs($bytes[$i + 1] - $bgc[1]) -gt $InkThreshold -or
          [math]::Abs($bytes[$i] - $bgc[2]) -gt $InkThreshold) {
        $rowInk[$y]++; $colInk[$x]++; $inkTotal++
      }
    }
  }
  $coverage = [math]::Round(100 * $inkTotal / ([math]::Ceiling($w / $step) * [math]::Ceiling($h / $step)), 1)
  "墨迹覆盖率 : $coverage%（>80% 视为以图像为主，改用 InDesign 侧量）"
  if ($coverage -gt 80) { "判定 : 该页以满版图为主，跳过版心与栏位检查。"; return }

  $top = -1; $bottom = -1; $left = -1; $right = -1
  for ($y = 0; $y -lt $h; $y += $step) { if ($rowInk[$y] -gt 0) { if ($top -lt 0) { $top = $y }; $bottom = $y } }
  for ($x = 0; $x -lt $w; $x += $step) { if ($colInk[$x] -gt 0) { if ($left -lt 0) { $left = $x }; $right = $x } }

  "=== 页面墨迹边界（含页码、标题、图版，不等于文本版心） ==="
  "  左边距 : $(Mm $left) mm    右边距 : $(Mm ($w - 1 - $right)) mm"
  "  上边距 : $(Mm $top) mm    下边距 : $(Mm ($h - 1 - $bottom)) mm"

  $checks = @()
  if ($CheckInkMargins) {
    if ($MarginLeftMm -ge 0) { $checks += @{ 项 = '左边距'; 实测 = (Mm $left); 期望 = $MarginLeftMm } }
    if ($MarginRightMm -ge 0) { $checks += @{ 项 = '右边距'; 实测 = (Mm ($w - 1 - $right)); 期望 = $MarginRightMm } }
    if ($MarginTopMm -ge 0) { $checks += @{ 项 = '上边距'; 实测 = (Mm $top); 期望 = $MarginTopMm } }
    if ($MarginBottomMm -ge 0) { $checks += @{ 项 = '下边距'; 实测 = (Mm ($h - 1 - $bottom)); 期望 = $MarginBottomMm } }
  }

  # 栏位：正文带中段做列投影
  $bandTop = $top + [int](($bottom - $top) * 0.15)
  $bandBottom = $top + [int](($bottom - $top) * 0.75)
  $bandCol = New-Object int[] $w
  for ($y = $bandTop; $y -le $bandBottom; $y += $step) {
    $rowoff = $y * $stride
    for ($x = 0; $x -lt $w; $x += $step) {
      $i = $rowoff + $x * 3
      if ([math]::Abs($bytes[$i + 2] - $bgc[0]) -gt $InkThreshold -or
          [math]::Abs($bytes[$i + 1] - $bgc[1]) -gt $InkThreshold -or
          [math]::Abs($bytes[$i] - $bgc[2]) -gt $InkThreshold) { $bandCol[$x]++ }
    }
  }
  $gapTolPx = [int](1.5 / $mmPerPx)
  $runs = @(); $runStart = -1; $gap = 0
  for ($x = 0; $x -lt $w; $x += $step) {
    if ($bandCol[$x] -gt 0) { if ($runStart -lt 0) { $runStart = $x }; $gap = 0 }
    elseif ($runStart -ge 0) {
      $gap += $step
      if ($gap -gt $gapTolPx) { $runs += [pscustomobject]@{ Start = $runStart; End = $x - $gap }; $runStart = -1; $gap = 0 }
    }
  }
  if ($runStart -ge 0) { $runs += [pscustomobject]@{ Start = $runStart; End = $w - 1 } }
  $runs = @($runs | Where-Object { (($_.End - $_.Start) * $mmPerPx) -ge 8 })

  "=== 栏位实测 ==="
  if ($runs.Count -eq 0) { "  未检出成栏的文本" }
  else {
    for ($i = 0; $i -lt $runs.Count; $i++) {
      $t = $runs[$i]
      $line = "  栏{0}: x {1}–{2} mm  宽 {3} mm" -f ($i + 1), (Mm $t.Start), (Mm ($t.End + 1)), (Mm ($t.End + 1 - $t.Start))
      if ($i -gt 0) { $line += "  距上一栏 {0} mm" -f (Mm ($t.Start - $runs[$i - 1].End - 1)) }
      "  $line"
    }
    "  栏数 : $($runs.Count)"
    if ($Columns -gt 0 -and $runs.Count -lt $Columns) { "  ⓘ 只检出 $($runs.Count) 栏有内容（设计 $Columns 栏）——多为文案未填满，需判断" }
    if ($GutterMm -ge 0 -and $runs.Count -gt 1) {
      $gv = Mm ($runs[1].Start - $runs[0].End - 1)
      $dv = [math]::Abs($gv - $GutterMm)
      "  栏距 : $gv mm（期望 $GutterMm mm，偏差 $([math]::Round($dv,1)) mm）" + $(if ($dv -gt $ToleranceMm) { '  ★ 超差' } else { '  ok' })
    }
    if ($ColumnWidthMm -ge 0) {
      $cw = [math]::Round((($runs | ForEach-Object { ($_.End - $_.Start) * $mmPerPx }) | Measure-Object -Average).Average, 1)
      $dw = [math]::Abs($cw - $ColumnWidthMm)
      "  平均栏宽 : $cw mm（期望 $ColumnWidthMm mm，偏差 $([math]::Round($dw,1)) mm）" + $(if ($dw -gt $ToleranceMm) { '  ★ 超差' } else { '  ok' })
    }
    if ($Columns -gt 0 -and $GutterMm -ge 0) {
      $cwAvg = [math]::Round((($runs | ForEach-Object { ($_.End - $_.Start) * $mmPerPx }) | Measure-Object -Average).Average, 1)
      "=== 文本区 ==="
      "  左边界 : $(Mm $runs[0].Start) mm    按设计推算右边界 : " +
        "$([math]::Round((Mm $runs[0].Start) + $Columns * $cwAvg + ($Columns - 1) * $GutterMm, 1)) mm"
      "  实际墨迹右边界 : $(Mm ($runs[-1].End + 1)) mm —— 内容填到第 $($runs.Count) 栏"
      $tbLeft = if ($TextBlockLeftMm -ge 0) { $TextBlockLeftMm } else { $MarginLeftMm }
      if ($tbLeft -ge 0) {
        $d2 = [math]::Round([math]::Abs((Mm $runs[0].Start) - $tbLeft), 1)
        "  文本区左边界核对 : 期望 $tbLeft mm，偏差 $d2 mm " + $(if ($d2 -le $ToleranceMm) { ' ok' } else { ' ★ 超差' })
      }
    }
  }

  # 行距（取第一栏）
  if ($runs.Count -gt 0) {
    $c0 = $runs[0]
    $lines = @(); $inLine = $false; $startY = 0; $lastInk = -1
    for ($y = 0; $y -lt $h; $y++) {
      $has = $false
      $rowoff = $y * $stride
      for ($x = $c0.Start; $x -le $c0.End; $x += [Math]::Max(2, $step)) {
        $i = $rowoff + $x * 3
        if ([math]::Abs($bytes[$i + 2] - $bgc[0]) -gt $InkThreshold -or
            [math]::Abs($bytes[$i + 1] - $bgc[1]) -gt $InkThreshold -or
            [math]::Abs($bytes[$i] - $bgc[2]) -gt $InkThreshold) { $has = $true; break }
      }
      if ($has) { if (-not $inLine) { $inLine = $true; $startY = $y }; $lastInk = $y }
      elseif ($inLine -and ($y - $lastInk) * $mmPerPx -gt 0.8) { $lines += [pscustomobject]@{ Top = $startY; Bottom = $lastInk }; $inLine = $false }
    }
    if ($inLine) { $lines += [pscustomobject]@{ Top = $startY; Bottom = $lastInk } }
    if ($lines.Count -ge 3) {
      $adv = @()
      for ($i = 1; $i -lt $lines.Count; $i++) { $adv += ($lines[$i].Top - $lines[$i - 1].Top) * $mmPerPx }
      $as = $adv | Sort-Object
      $medianAdv = $as[[int]($as.Count / 2)]
      $bodyH = (($lines | ForEach-Object { ($_.Bottom - $_.Top + 1) * $mmPerPx }) | Sort-Object)[[int]($lines.Count / 2)]
      "=== 正文行（第一栏） ==="
      "  检出 $($lines.Count) 行   行距中位数 $([math]::Round($medianAdv,1)) mm（≈ $([math]::Round($medianAdv/0.3528,1)) pt）"
      "  字面高中位数 $([math]::Round($bodyH,1)) mm（≈ $([math]::Round($bodyH/0.3528,1)) pt）"
    }
  }

  "=== 边距规格核对 ==="
  if (-not $CheckInkMargins) { "  ⓘ 未加 -CheckInkMargins：页边距对照默认关闭（墨迹边界含页码与标题，易假报警）" }
  elseif ($checks.Count -eq 0) { "  （已开启但未提供期望值）" }
  else {
    foreach ($c in $checks) {
      $d = [math]::Round([math]::Abs($c.实测 - $c.期望), 1)
      "  {0,-8} 实测 {1,6} mm  期望 {2,6} mm  偏差 {3,4} mm  {4}" -f $c.项, $c.实测, $c.期望, $d, $(if ($d -le $ToleranceMm) { 'ok' } else { '★ 超差' })
    }
  }
}
finally {
  $src.Dispose()
}
