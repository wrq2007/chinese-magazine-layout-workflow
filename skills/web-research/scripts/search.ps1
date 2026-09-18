<#
.SYNOPSIS
  用可用的中文搜索引擎检索，输出「标题 + 链接」。
.DESCRIPTION
  只输出标题与链接——搜索摘要里常混入引擎的 HTML/埋点数据，不可靠；
  结论一律用 fetch.ps1 打开原文核对（搜索只是线索）。
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File search.ps1 -Query "中国国家地理 杂志 字体" -Top 8
#>
param(
  [Parameter(Mandatory = $true)][string]$Query,
  [ValidateSet('auto', 'bing', 'baidu', 'so360', 'sogou')][string]$Engine = 'auto',
  [int]$Top = 8
)

$ErrorActionPreference = 'Continue'
$headers = @{
  'User-Agent'      = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36'
  'Accept'          = 'text/html,application/xhtml+xml,*/*;q=0.8'
  'Accept-Language' = 'zh-CN,zh;q=0.9,en;q=0.8'
}
$q = [uri]::EscapeDataString($Query)
$map = [ordered]@{
  bing  = "https://cn.bing.com/search?q=$q"      # 用户指定优先走 Bing
  baidu = "https://www.baidu.com/s?wd=$q"
  so360 = "https://www.so.com/s?q=$q"
  sogou = "https://www.sogou.com/web?query=$q"
}
$order = if ($Engine -eq 'auto') { @('bing', 'baidu', 'so360', 'sogou') } else { @($Engine) }

# 相关性闸门：本机实测 Bing 会返回"只匹配第一个词"的降级结果（查询词在标题里几乎不出现）。
# 命中率过低就判为不相关，自动换下一个引擎。
$terms = @($Query -split '\s+' | Where-Object { $_.Length -ge 2 })

function CleanText([string]$s) {
  $t = $s -replace '(?s)<[^>]*>', ' '
  $t = [System.Net.WebUtility]::HtmlDecode($t)
  return ($t -replace '\s+', ' ').Trim()
}

foreach ($name in $order) {
  try {
    $r = Invoke-WebRequest -Uri $map[$name] -TimeoutSec 25 -UseBasicParsing -Headers $headers -ErrorAction Stop
  } catch {
    Write-Output "【$name】请求失败：$($_.Exception.Message.Split("`n")[0])"
    continue
  }
  # 先把 <a> 的 href 留下、其余属性全部丢弃；其它标签一律削成 <tag>。
  # 这样既避免属性里的引号/JSON 干扰解析，又不丢链接。
  $html = [regex]::Replace($r.Content, '<a\s[^>]*?href="([^"]+)"[^>]*>', '<a href="$1">')
  $html = [regex]::Replace($html, '<(\w+)(\s[^>]*)?>', {
      param($m)
      if ($m.Groups[1].Value -eq 'a' -and $m.Value -match 'href=') { return $m.Value }
      return '<' + $m.Groups[1].Value + '>'
    })
  $ms = [regex]::Matches($html, '(?s)<h3>\s*<a href="([^"]+)"[^>]*>(.*?)</a>',
    [System.Text.RegularExpressions.RegexOptions]::Singleline)
  if ($ms.Count -eq 0) {
    $ms = [regex]::Matches($html, '(?s)<h3[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>(.*?)</a>',
      [System.Text.RegularExpressions.RegexOptions]::Singleline)
  }
  # Bing 的结构：<li class="b_algo"><h2><a href=...>标题</a>
  if ($ms.Count -eq 0) {
    $ms = [regex]::Matches($html, '(?s)<h2>\s*<a href="([^"]+)"[^>]*>(.*?)</a>',
      [System.Text.RegularExpressions.RegexOptions]::Singleline)
  }
  Write-Output "=== 引擎：$name（HTTP $($r.StatusCode)，解析到 $($ms.Count) 条）==="
  $n = 0
  $hitTerms = 0
  foreach ($m in $ms) {
    if ($n -ge $Top) { break }
    $title = CleanText $m.Groups[2].Value
    $url = [System.Net.WebUtility]::HtmlDecode($m.Groups[1].Value)
    if ($title.Length -lt 4) { continue }
    # 过滤纯图片/视频入口
    if ($url -match 'image\.baidu|video\.baidu|/i\?') { continue }
    foreach ($term in $terms) { if ($title -like "*$term*") { $hitTerms++; break } }
    $n++
    Write-Output ("{0}. {1}" -f $n, $title)
    Write-Output ("   {0}" -f $url)
  }
  # 相关性判定：多词查询时，标题里至少要命中一个词，否则视为降级结果
  $relevant = ($terms.Count -le 1) -or ($n -gt 0 -and $hitTerms -ge [Math]::Max(1, [int]($n * 0.3)))
  if ($n -gt 0 -and $relevant) { break }
  if ($n -gt 0 -and -not $relevant) {
    Write-Output "⚠ $name 的结果与查询不相关（$n 条里只有 $hitTerms 条标题含查询词）——视为降级结果，换下一个引擎"
    continue
  }
  Write-Output '（该引擎未解析出结果，换下一个）'
}
