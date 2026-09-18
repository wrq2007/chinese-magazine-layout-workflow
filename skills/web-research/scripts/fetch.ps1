<#
.SYNOPSIS
  取网页正文：剥脚本/样式/注释/标签，解码实体，压空白，按需截断。
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File fetch.ps1 -Url "https://example.com/a.html" -MaxChars 3000
#>
param(
  [Parameter(Mandatory = $true)][string]$Url,
  [int]$MaxChars = 4000,
  [switch]$Raw
)
$ErrorActionPreference = 'Stop'
$headers = @{
  'User-Agent'      = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36'
  'Accept'          = 'text/html,application/xhtml+xml,*/*;q=0.8'
  'Accept-Language' = 'zh-CN,zh;q=0.9,en;q=0.8'
}
$r = Invoke-WebRequest -Uri $Url -TimeoutSec 30 -UseBasicParsing -Headers $headers -MaximumRedirection 6
if ($Raw) { Write-Output $r.Content; exit 0 }

$t = $r.Content
$t = [regex]::Replace($t, '(?s)<script.*?</script>', ' ')
$t = [regex]::Replace($t, '(?s)<style.*?</style>', ' ')
$t = [regex]::Replace($t, '(?s)<!--.*?-->', ' ')
$t = [regex]::Replace($t, '(?i)</(p|div|li|h[1-6]|tr|section|article)>', "`n")
$t = [regex]::Replace($t, '(?s)<[^>]*>', ' ')
$t = [System.Net.WebUtility]::HtmlDecode($t)
$lines = $t -split "`n" | ForEach-Object { ($_ -replace '\s+', ' ').Trim() } | Where-Object { $_ -ne '' -and $_.Length -gt 1 }
$t = ($lines -join "`n")

Write-Output ("[地址] {0}" -f $r.BaseResponse.ResponseUri)
if ($t.Length -gt $MaxChars) {
  Write-Output $t.Substring(0, $MaxChars)
  Write-Output ("…（正文共 {0} 字，已截断；需要更多用 -MaxChars 指定）" -f $t.Length)
} else {
  Write-Output $t
}
