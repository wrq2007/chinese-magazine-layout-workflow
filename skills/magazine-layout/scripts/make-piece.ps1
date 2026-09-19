<#
.SYNOPSIS
  单篇成品流水线：背景（自动校准对比度）→ 解析源文 → 配置驱动排版 → 合成预览 → 规格检查。
  文本不变式：正文只复制粘贴（脚本从源文件读入、原样流入排版），不增不删不改一个字——因此不做事后比对。
.DESCRIPTION
  一条命令产出整套交付物：印刷 PDF、可编辑 .indd、预览图、局部放大图，并自带验收报告。
  设计原则：文本只从源文件读取（不手打），可量测的项全部程序化检查，不依赖反复人工复核。
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File make-piece.ps1 -Config E:\项目\_build\piece.json `
    -Source E:\项目\文稿.docx -Background E:\项目\底图.jpg
#>
param(
  [Parameter(Mandatory = $true)][string]$Config,
  [string]$Source,
  [string]$Background,
  [switch]$SkipBackground,
  [switch]$SkipBuild
)

$ErrorActionPreference = 'Continue'
$skill = 'C:\Users\Wrq07\.codex\skills\magazine-layout\scripts'
$qcSkill = 'C:\Users\Wrq07\.codex\skills\layout-qc\scripts'
$runner = 'C:\Users\Wrq07\Documents\Codex\2026-09-16\di-y\work\id-run.mjs'
$env:PYTHONUTF8 = '1'

$cfg = Get-Content -LiteralPath $Config -Raw -Encoding UTF8 | ConvertFrom-Json
$work = $cfg.workDir
$outDir = $cfg.outDir
New-Item -ItemType Directory -Force -Path $work, $outDir | Out-Null
$t总 = Get-Date
$steps = @()

function Step($name, $script) {
  $t = Get-Date
  Write-Output ""
  Write-Output "=== $name ==="
  & $script
  $steps += [pscustomobject]@{ 步骤 = $name; 秒 = [math]::Round(((Get-Date) - $t).TotalSeconds, 1) }
}

# 自动补 UTF-8 BOM：PowerShell 5.1 读无 BOM 的含中文脚本会按 ANSI 解析导致语法错误（错误档案 B11）
function Ensure-Bom([string]$path) {
  if (-not (Test-Path -LiteralPath $path)) { return }
  $bytes = [IO.File]::ReadAllBytes($path)
  if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) { return }
  $text = [IO.File]::ReadAllText($path, [Text.Encoding]::UTF8)
  [IO.File]::WriteAllText($path, $text, (New-Object System.Text.UTF8Encoding $true))
  Write-Output ("  [已为 {0} 补 UTF-8 BOM]" -f (Split-Path $path -Leaf))
}
Ensure-Bom (Join-Path $skill 'make-background.ps1')

# 1) 背景
if ($Background -and -not $SkipBackground) {
  $t = Get-Date
  Write-Output ""
  Write-Output '=== 1/5 背景（模糊 + 遮罩 + 自动对比度校准）==='
  & powershell -ExecutionPolicy Bypass -File (Join-Path $skill 'make-background.ps1') `
    -Source $Background -OutDir $work `
    -PageCount $cfg.page.pages -PageWidthMm $cfg.page.widthMm -PageHeightMm $cfg.page.heightMm -BleedMm $cfg.page.bleedMm `
    -TextRgb (($cfg.colors.text) -join ',') -TopMm $cfg.margins.top -BottomMm ($cfg.page.heightMm - $cfg.margins.bottom)
  $steps += [pscustomobject]@{ 步骤 = '1 背景'; 秒 = [math]::Round(((Get-Date) - $t).TotalSeconds, 1) }
}

# 2) 解析源文
if ($Source) {
  $t = Get-Date
  Write-Output ""
  Write-Output '=== 2/5 解析源文（段落数组，供排版原样取用——只复制粘贴）==='
  & python (Join-Path $skill 'extract-text.py') $Source $work
  $steps += [pscustomobject]@{ 步骤 = '2 解析源文'; 秒 = [math]::Round(((Get-Date) - $t).TotalSeconds, 1) }
}

# 3) 排版（一次 InDesign 调用：建→排→导→查→存→关）
if (-not $SkipBuild) {
  $t = Get-Date
  Write-Output ""
  Write-Output '=== 3/5 排版（单次 InDesign 调用）==='
  Push-Location (Split-Path $runner -Parent)
  & node $runner (Join-Path $skill 'build-piece.jsx') 2>&1 | Select-String -Pattern '排版：|自查|PDF|页图|文字|源文件|耗时|ERROR|CONFIG_NOT_FOUND'
  Pop-Location
  $steps += [pscustomobject]@{ 步骤 = '3 排版'; 秒 = [math]::Round(((Get-Date) - $t).TotalSeconds, 1) }
}

# 4) 合成预览 + 局部图
$t = Get-Date
Write-Output ""
Write-Output '=== 4/5 预览合成与局部图 ==='
Add-Type -AssemblyName System.Drawing
$ppm = 300 / 25.4
function SaveJpeg($bmp, $path, $q) {
  $enc = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
  $ep = New-Object System.Drawing.Imaging.EncoderParameters 1
  $ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), $q
  $bmp.Save($path, $enc, $ep); $ep.Dispose()
}
function CropMm($srcPath, $xMm, $yMm, $wMm, $hMm, $outPath) {
  $img = [System.Drawing.Image]::FromFile($srcPath)
  $bmp = [System.Drawing.Bitmap]::new([int]($wMm * $ppm), [int]($hMm * $ppm)); $bmp.SetResolution(300, 300)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.DrawImage($img, [System.Drawing.Rectangle]::new(0, 0, $bmp.Width, $bmp.Height),
    [System.Drawing.Rectangle]::new([int]($xMm * $ppm), [int]($yMm * $ppm), $bmp.Width, $bmp.Height), [System.Drawing.GraphicsUnit]::Pixel)
  $g.Dispose(); SaveJpeg $bmp $outPath 95; $bmp.Dispose(); $img.Dispose()
}
$pageFiles = @(Join-Path $work 'hi.jpg')
if ($cfg.page.pages -gt 1) { $pageFiles += (Join-Path $work 'hi2.jpg') }
$imgs = @(); foreach ($f in $pageFiles) { $imgs += [System.Drawing.Image]::FromFile($f) }
$wsum = ($imgs | Measure-Object Width -Sum).Sum; $hmax = ($imgs | Measure-Object Height -Maximum).Maximum
$spread = [System.Drawing.Bitmap]::new([int]$wsum, [int]$hmax); $spread.SetResolution(300, 300)
$g2 = [System.Drawing.Graphics]::FromImage($spread); $xoff = 0
foreach ($im in $imgs) { $g2.DrawImage($im, $xoff, 0, $im.Width, $im.Height); $xoff += $im.Width }
$g2.Dispose(); SaveJpeg $spread (Join-Path $outDir ($cfg.outputBase + '_预览.jpg')) 95
$gotW = [math]::Round($spread.Width / $ppm); $gotH = [math]::Round($spread.Height / $ppm)
$wantW = [math]::Round($cfg.page.widthMm * $cfg.page.pages); $wantH = $cfg.page.heightMm
Write-Output ("  跨页预览 {0}×{1}px @300dpi = {2}×{3}mm" -f $spread.Width, $spread.Height, $gotW, $gotH)
if ([math]::Abs($gotW - $wantW) -gt 1 -or [math]::Abs($gotH - $wantH) -gt 1) {
  Write-Output ("  ★ 页图与规格不符：期望 {0}×{1}mm，实际 {2}×{3}mm —— 页图可能是上一轮遗留的（检查预览 DPI 与开本配置）" -f $wantW, $wantH, $gotW, $gotH)
}
$spread.Dispose(); foreach ($im in $imgs) { $im.Dispose() }

CropMm (Join-Path $work 'hi.jpg') ($cfg.margins.inside - 6) 24 140 44 (Join-Path $outDir ($cfg.outputBase + '_局部_标题.jpg'))
Write-Output '  局部：标题区'
CropMm (Join-Path $work 'hi.jpg') ($cfg.margins.inside - 6) $cfg.start.bodyTopMm 140 40 (Join-Path $outDir ($cfg.outputBase + '_局部_正文.jpg'))
Write-Output '  局部：正文'
$lastPage = if ($cfg.page.pages -gt 1) { Join-Path $work 'hi2.jpg' } else { Join-Path $work 'hi.jpg' }
CropMm $lastPage 80 ($cfg.page.heightMm - 74) 100 50 (Join-Path $outDir ($cfg.outputBase + '_局部_署名.jpg'))
Write-Output '  局部：页尾署名区'
$steps += [pscustomobject]@{ 步骤 = '4 预览与局部'; 秒 = [math]::Round(((Get-Date) - $t).TotalSeconds, 1) }

# 5) 规格检查
$t = Get-Date
Write-Output ""
Write-Output '=== 5/5 规格检查 ==='
$pdf = Join-Path $outDir ($cfg.outputBase + '.pdf')
$bytes = [IO.File]::ReadAllBytes($pdf); $lat = [Text.Encoding]::GetEncoding(28591).GetString($bytes)
foreach ($box in @('TrimBox', 'BleedBox')) {
  $m = [regex]::Matches($lat, "/$box\s*\[([^\]]+)\]")
  if ($m.Count -gt 0) {
    $n = ($m[0].Groups[1].Value.Trim() -split '\s+')
    Write-Output ("  /{0} = {1} × {2} mm" -f $box, [math]::Round(([double]$n[2] - [double]$n[0]) / 2.8346456693, 1), [math]::Round(([double]$n[3] - [double]$n[1]) / 2.8346456693, 1))
  }
}
Write-Output ("  CMYK 标记 = {0}  页数 = {1}" -f ([regex]::Matches($lat, 'DeviceCMYK').Count), ([regex]::Match($lat, '/Count\s+(\d+)').Groups[1].Value))
& powershell -ExecutionPolicy Bypass -File (Join-Path $qcSkill 'list-pdf-fonts.ps1') -Path $pdf 2>&1 | Select-String -Pattern '^\s{2}\S' | ForEach-Object { "  字体: " + $_.Line.Trim() }
$steps += [pscustomobject]@{ 步骤 = '5 检查与比对'; 秒 = [math]::Round(((Get-Date) - $t).TotalSeconds, 1) }

Write-Output ""
Write-Output '=== 汇总 ==='
$steps | Format-Table -AutoSize
Write-Output ("总耗时 {0} 秒" -f [math]::Round(((Get-Date) - $t总).TotalSeconds, 1))
$srcLeaf = if ($Source) { Split-Path $Source -Leaf } else { '' }
Get-ChildItem $outDir -File | Where-Object {
    $_.Name -notlike '~*' -and
    ($srcLeaf -eq '' -or $_.Name -ne $srcLeaf) -and
    $_.Name -notlike '*.docx' -and $_.Name -notlike '*.jpg' -and
    $_.Name -like ($cfg.outputBase + '*')
  } |
  Select-Object Name, @{n = 'KB'; e = { [math]::Round($_.Length / 1KB) } } | Format-Table -AutoSize
