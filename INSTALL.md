# 安装与适配

## 1. 安装技能

### Codex

```powershell
Copy-Item .\skills\* "$HOME\.codex\skills\" -Recurse -Force
```

装完新开一个会话即可，技能会自动出现在可用列表里。

> **2026-09-20 起本工作流不再需要第二个运行体。** 此前 Codex 看不了图，所以另装了一个
> DeepSeek Harness（dsh）负责看图与写文案；现在 Codex 自己就能读图，那部分工作已整体接过来，
> 交接清单见 [docs/AGENTS.md](docs/AGENTS.md) 的「视觉工作由谁做」。
>
> 所以**只装 Codex 那一份就行**。若你手上已有 dsh 环境，旧配置写法保留在
> [docs/architecture.md](docs/architecture.md) 作参考，但例行流程不再调用它。

## 2. 改占位路径（必做）

为保护原作者环境，脚本里的个人路径都替换成了占位符，直接跑会失败。请全局替换：

| 占位符 | 改成 |
| --- | --- |
| `YOUR_NAME` | 你的 Windows 用户名 |
| `E:/YOUR_PROJECT`、`E:\YOUR_PROJECT` | 你的项目目录（例如 `E:/my-magazine`） |
| `C:/path/to/your/indesign-mcp-server` | 你的 InDesign MCP 桥接目录 |

需要改的文件（用编辑器全局替换即可）：

```
skills/magazine-layout/scripts/build-layout.jsx      # 配置路径
skills/magazine-layout/scripts/build-piece.jsx       # 配置路径
skills/magazine-layout/scripts/magazine-skeleton.jsx # 导出路径
skills/magazine-layout/scripts/make-piece.ps1        # 技能目录与运行器路径
skills/layout-qc/scripts/*.ps1                      # 少量绝对路径
docs/AGENTS.md                                       # 项目指令里的路径
```

## 3. 前置条件

| 依赖 | 说明 |
| --- | --- |
| Adobe InDesign（Windows） | 通过 COM 驱动；建议 2024+ |
| InDesign MCP 桥接 | 一个能执行 ExtendScript 的 MCP server（本项目用 stdio 方式）；也可用本仓库的 `work/id-run.mjs` 这类轻量运行器直连 |
| Node.js | 运行 MCP 客户端脚本（`id-run.mjs`） |
| Python 3 | 源文解析（`extract-text.py`） |
| PowerShell 5.1+ | 量测与流水线脚本 |

**PowerShell 注意**：本机执行策略若为 Restricted，一律用
`powershell -ExecutionPolicy Bypass -File xxx.ps1` 调用；
**含中文的 .ps1 必须存成 UTF-8 with BOM**，否则 5.1 会按 ANSI 解析并报语法错误。

## 4. 跑一遍最小流程

```powershell
# 1) 解析源文 → 段落数组
python skills/magazine-layout/scripts/extract-text.py "你的文稿.docx" "E:/YOUR_PROJECT/_build"

# 2) 生成背景（模糊 + 渐变遮罩 + 自动对比度校准）
powershell -ExecutionPolicy Bypass -File skills/magazine-layout/scripts/make-background.ps1 `
  -Source "你的底图.jpg" -OutDir "E:/YOUR_PROJECT/_build" -PageCount 2 `
  -PageWidthMm 185 -PageHeightMm 260 -BleedMm 3

# 3) 按配置排版（先照 examples/ 改一份 layout.json 到你的 _build 目录）
node work/id-run.mjs skills/magazine-layout/scripts/build-layout.jsx

# 4) 验收：一条命令跑完十项（页面盒/出血/DPI、边距、内嵌字体、装饰一致性、
#    孤字成行、总墨量 TAC、文字墨色色版、输出意图、图注、文字保真）
python skills/layout-qc/scripts/qc-all.py "产物.pdf" --sources "你的文稿.docx"
# 备用：在 InDesign 内执行 check-overlap.jsx；查字体名 list-pdf-fonts.ps1
```

## 5. 出问题先看这里

- `skills/layout-qc/references/mistakes-brief.md` —— **开工先读这一份**（约 2KB，19 条真实踩过的坑：单位、母版、出血、字体回退、BOM、并行安全…）；
- `skills/layout-qc/references/mistakes-log.md` —— 全档（更大，列细节时才查，别每轮全读）；
- `skills/layout-qc/references/indesign-pitfalls.md` —— InDesign 自动化的具体 API 陷阱；
- `docs/AGENTS.md` —— 如果你想把这个工作流交给 AI 接手，把这份放进项目根目录即可。
