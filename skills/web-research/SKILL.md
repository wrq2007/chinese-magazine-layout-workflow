---
name: web-research
description: 在本机联网做资料检索与网页取正文——按"能用/不能用"的实测结论选通道，把搜索结果与网页正文转成可引用文本。用于查资料、核实事实、找参考与素材来源；不用于本机文件操作或需要登录的站点。
---

# 联网检索与取正文

## 本机实测的通道状况（2026-09-18 实测，会随网络环境变化）

| 用途 | 可用 | 不可用 |
| --- | --- | --- |
| 搜索 | **Baidu**、**360搜索**、**搜狗** | **Bing**（见下）、DuckDuckGo（超时）、Mojeek（403）、Ecosia（只剩 Bing 外壳） |
| 代码/素材源 | **GitHub API**、**raw.githubusercontent.com** | — |
| 官方 OpenAI 文档 | — | `developers.openai.com`、`platform.openai.com`（403）；`r.jina.ai` 读取代理也不可达 |
| 其他 | 多数普通站点可直连（如 foundertype.com） | 维基百科 API 超时 |

**先跑 `scripts/search.ps1`，失败再换引擎**；不要因为一个引擎不可用就断定"没有联网"。

### 关于 Bing（用户要求优先，但本机实测不可用）

默认顺序是 **Bing → Baidu → 360 → 搜狗**，并带一道**相关性闸门**：命中率过低自动降级到下一个引擎。

2026-09-18 实测证据：用 `中国国家地理 杂志 字体` 查询 cn.bing.com 与 www.bing.com，页面 `<title>` 与搜索框的值**都是完整查询**（说明 Bing 收到了查询），但主结果区 9 条 `b_algo` 全部是"中华人民共和国_百度百科""中国政府网"这类只匹配第一个词"中国"的结果。换 `%20`、`+`、引号短语、纯英文多词查询都一样。因此在本机：**Bing 放第一位试，但基本每次都会由闸门降级**；等网络环境变化后它会自动生效，无需改脚本。

## 脚本

`scripts/search.ps1 -Query "<关键词>" [-Engine auto|baidu|so360|sogou] [-Top 8]`
→ 输出标题 / 链接 / 摘要（Baidu 的链接是跳转链接，可用 fetch.ps1 跟进）。

`scripts/fetch.ps1 -Url "<网址>" [-MaxChars 4000] [-Raw]`
→ 取网页正文（剥脚本样式与标签、解码实体、压空白）。默认截断到 4000 字，`-Raw` 取原始 HTML。

调用注意：本机 PowerShell 执行策略为 Restricted，一律用 `powershell -ExecutionPolicy Bypass -File ...`；脚本含中文，保存时必须带 UTF-8 BOM（见 `layout-qc/references/mistakes-log.md` B11）。

## 使用原则

- **搜索结果只是线索，结论要落到正文**：先 search 找候选，再 fetch 打开原文核对；引用时给出 URL。
- **别把搜索摘要当事实**：中文搜索引擎的摘要有聚合与改写，关键数字/名称必须回原文。
- **官方 OpenAI 文档在本机读不到**：涉及 OpenAI/Codex 自身的问题时，明确说明"官方文档不可达，以下为本机实测或既有知识"，不要伪造引用。
- 需要登录、需要 JS 渲染的站点取不到正文——这时改找镜像或换源，不要反复重试。
