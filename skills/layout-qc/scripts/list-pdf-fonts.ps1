<#
.SYNOPSIS
  列出 PDF 里内嵌/引用的字体名（含对象流中被 Flate 压缩的部分）。

.DESCRIPTION
  两种用途：
   1) 交付质检：确认成品 PDF 用了哪些字体、是否嵌入子集；
   2) 字体调研：拿到某本杂志/画册的 PDF，直接读出它实际使用的字体，不靠猜。
  只读操作。

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File list-pdf-fonts.ps1 -Path .\magazine.pdf
#>
param(
  [Parameter(Mandatory = $true)][string]$Path,
  [switch]$Raw
)

$ErrorActionPreference = 'Stop'
$resolved = (Resolve-Path -LiteralPath $Path).Path
$bytes = [System.IO.File]::ReadAllBytes($resolved)
$latin = [System.Text.Encoding]::GetEncoding(28591)

function Decode-PdfName([string]$name) {
  # PDF 名字里的 #XX 转义
  $out = [regex]::Replace($name, '#([0-9A-Fa-f]{2})', { param($m) [char][Convert]::ToInt32($m.Groups[1].Value, 16) })
  return $out
}

function Strip-Subset([string]$name) {
  # 去掉 ABCDEF+ 这样的子集前缀
  return [regex]::Replace($name, '^[A-Z]{6}\+', '')
}

$found = New-Object 'System.Collections.Generic.HashSet[string]'

function Harvest([string]$text) {
  foreach ($m in [regex]::Matches($text, '/(?:BaseFont|FontName)\s*/([^\s/<>\[\]\(\)]+)')) {
    $n = Strip-Subset (Decode-PdfName $m.Groups[1].Value)
    if ($n -and $n.Length -gt 1) { [void]$script:found.Add($n) }
  }
}

$text = $latin.GetString($bytes)
Harvest $text

# 解压 FlateDecode 流后再扫一遍（PDF 1.5+ 对象流会把字体名压进去）
$streamCount = 0; $okCount = 0
$rx = [regex]'stream\r?\n'
foreach ($m in $rx.Matches($text)) {
  $start = $m.Index + $m.Length
  $end = $text.IndexOf('endstream', $start)
  if ($end -lt 0) { continue }
  $streamCount++
  $len = $end - $start
  if ($len -le 0 -or $len -gt 20000000) { continue }
  $slice = New-Object byte[] $len
  [Array]::Copy($bytes, $start, $slice, 0, $len)
  try {
    $ms = New-Object System.IO.MemoryStream(, $slice)
    $ds = New-Object System.IO.Compression.DeflateStream($ms, [System.IO.Compression.CompressionMode]::Decompress)
    $reader = New-Object System.IO.StreamReader($ds, $latin)
    $decoded = $reader.ReadToEnd()
    $reader.Close(); $ds.Close(); $ms.Close()
    Harvest $decoded
    $okCount++
  }
  catch { }
}

"=== PDF 字体清单 ==="
"文件   : $resolved"
"大小   : $([math]::Round((Get-Item -LiteralPath $resolved).Length / 1MB, 2)) MB"
"流扫描 : 共 $streamCount 个流，成功解压 $okCount 个"
"字体数 : $($found.Count)"
""
if ($found.Count -eq 0) {
  "未直接解析到字体名。该 PDF 可能全部使用压缩对象流；可用其他方式（InDesign/PDF 阅读器的文档属性）核对。"
}
else {
  $found | Sort-Object | ForEach-Object {
    $mark = ''
    if ($_ -match '(?i)^(Arial|Times|Helvetica|Courier|Symbol|Calibri|Cambria|Segoe)') { $mark = '  [西文系统字]' }
    elseif ($_ -match '(?i)(Han|Noto|YaHei|SimSun|SimHei|Song|Hei|Kai|Fang|Ming|Gothic|Gothic|SC|TC|CN)') { $mark = '  [CJK 相关]' }
    "  $_$mark"
  }
}
