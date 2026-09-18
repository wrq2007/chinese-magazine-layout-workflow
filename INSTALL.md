# 安装与适配

## 1. 安装技能

### Codex

```powershell
Copy-Item .\skills\* "$HOME\.codex\skills\" -Recurse -Force
```

装完新开一个会话即可，技能会自动出现在可用列表里。

### DeepSeek Harness（如使用）

```powershell
Copy-Item .\skills\* "$HOME\.dsh\skills\" -Recurse -Force
```

dsh 的本地技能根目录为：`<项目>/.dsh/skills`、`<项目>/.agents/skills`、`~/.dsh/skills`。

> dsh（DeepSeek Harness）在本工作流里承担**视觉复读与文案生成**（依托 DeepSeek 的视觉/语言模型），
> 与 Codex 共用同一台 InDesign。InDesign MCP 桥接在 dsh 侧的配置写法、并行安全纪律、
> 以及实测性能数据见 [docs/architecture.md](docs/architecture.md)。

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

# 4) 验收
powershell -ExecutionPolicy Bypass -File skills/layout-qc/scripts/check-overlap.jsx   # 在 InDesign 内执行
powershell -ExecutionPolicy Bypass -File skills/layout-qc/scripts/list-pdf-fonts.ps1 -Path "产物.pdf"
```

## 5. 出问题先看这里

- `skills/layout-qc/references/mistakes-log.md` —— 16 条真实踩过的坑（单位、母版、出血、字体回退、BOM、并行安全…）；
- `skills/layout-qc/references/indesign-pitfalls.md` —— InDesign 自动化的具体 API 陷阱；
- `docs/AGENTS.md` —— 如果你想把这个工作流交给 AI 接手，把这份放进项目根目录即可。
