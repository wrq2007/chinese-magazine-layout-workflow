# 中文刊物 AI 排版工作流（Codex + InDesign）

> An AI-assisted print layout workflow for Chinese magazines and books —
> skills, a pattern-driven layout engine, and measurement-based acceptance checks.
> Built for 185×260mm, 3mm bleed, CMYK, perfect binding, 175 lpi.

一套**能真正交付印刷**的中文排版工作流：把「文案 + 图片 + 一句需求」变成
印刷级 PDF、可编辑源文件、审样预览，并自带量化验收。
它不是一堆提示词，而是**可执行的脚本 + 可复用的规则 + 可验证的检查**。

---

## 它解决什么问题

用通用聊天机器人排中文刊物，通常会遇到四件事：

1. **排得出来、印不出来**——出血、色域、内嵌字体、总墨量全是坑；
2. **中文字不对味**——行宽过长、小字反白、标点规则不对、数字用中文字形的西文；
3. **AI 味重**——到处加粗、渐变滥用、模板化版式；
4. **无法验收**——"看起来不错"不能交付，必须有像素与毫米级的证据。

这套工作流的每一部分都对应上面的一个坑，并且**每条规则都有来源或实测依据**。

## 一图看清

```
素材（文案 docx/md/txt  +  图片 1..n  +  一句需求）
        │
        ├─ extract-text.py     源文 → 段落数组（文本只复制粘贴，一个字符都不改）
        ├─ make-background.ps1 照片 → 裁切/高斯模糊/渐变遮罩/暗部提亮
        │                      ✦ 自动对比度校准：逐级加码直到全文区 ≥4.5:1
        │
        ├─ build-layout.jsx    pattern 驱动的版式引擎
        │                      cover / text / plate / imageText / quote / toc / signature / blank
        │                      ✦ 自动串文（一条文本流跨页续排）
        │                      ✦ 图片按格位比例自动裁切填充
        │                      ✦ 内建自检：框重叠 / 溢出 / 避头尾 / 行宽
        │
        ├─ make-piece.ps1      一条命令跑完整条流水线并汇总耗时
        │
        └─ layout-qc/          成品验收（六项，全部量化）
           ├─ check-overlap.jsx         文本框重叠（绝对定位不会报错，必须程序化查）
           ├─ check-cjk-typography.jsx  避头尾 / 标点配对 / 中西文字体 / 行宽 / 缩进
           ├─ check-contrast.ps1        文字压图的对比度（正文 ≥4.5:1，大标题 ≥3:1）
           ├─ check-layout-rules.ps1    栏数/栏宽/栏距/行距/文本区边界
           ├─ list-pdf-fonts.ps1        PDF 实际内嵌的字体（"回读正常≠渲染生效"）
           └─ measure-export.ps1        像素+DPI 反推物理尺寸、色带、文字包围盒
```

## 五个技能（skill）

技能是这套工作流的"长期记忆"：新会话自动可见，不必重讲背景。

| 技能 | 职责 | 关键内容 |
| --- | --- | --- |
| **art-direction** | 审美与用字判断 | 从尺度取值、层级靠字重与颜色、强调配给制、有意断网格、反 AI 味清单、中文字体与混排、数据图规范 |
| **magazine-layout** | 多页结构与版式引擎 | 开本页数规划、母版/样式/栅格体系、文章流、跨页节奏、**内容层排印规范**、pattern 引擎与流水线脚本 |
| **cng-magazine-layout** | 规格来源（有刊例依据） | 185×260 中文地理人文类刊物的版心/栅格/字号阶梯/图片像素表/印前规格 |
| **layout-qc** | 成品验收 | 六项量化检查 + **错误档案**（真实踩过的坑）+ 工具脚本 |
| **web-research** | 联网检索 | 本机实测可用的搜索通道、相关性闸门、取网页正文 |

设计原则：**判断、结构、验收、检索各司其职**，不合成为一个巨型文件——
混在一起会让"审美标准"和"验收标准"互相污染，而且每次都要把全部内容读进上下文。

## 工作流的四条内核

### 1. 文本只复制粘贴，不改一个字

正文一律由脚本从源文件读入、原样流入排版：
**不增加、不删除、不修改任何字符**（含标点、空格、数字、`&` 这类特殊符号）。
需要改内容先问用户。守住这条不变式，就不需要事后逐字比对。

> 这条来自两次真实事故：漏掉"动**&**静"的 `&`；把作者写的逗号擅自改成顿号。

### 2. 规格有来源，且可以随时改

开本、版心、栏格、字号、素材分辨率等**生产数值**统一由 `cng-magazine-layout` 提供
（来源：刊物官方广告刊例 + 行业通行系数），其余技能不重复定义数值。

### 3. 能算的都别靠眼

比例、尺寸、对齐、边界、对比度一律程序化量测；视觉模型只用来**逐字转录**和描述元素。
实测教训：让视觉模型估版面比例，它把 16% 说成 48%，据此得出的"排版失衡"结论完全错误。

### 4. 交付必须有证据

任何"已完成"都要附实测数据：像素尺寸、DPI、毫米、色值、对比度、PDF 版面盒、内嵌字体名。
做不到就明确说明未完成与原因。

## 目录结构

```
.
├── README.md                    本文
├── INSTALL.md                   安装与适配（把占位路径改成你自己的）
├── LICENSE
├── skills/
│   ├── art-direction/           审美与用字（1 入口 + 9 参考）
│   ├── magazine-layout/         结构与引擎（SKILL + 4 参考 + 6 脚本）
│   ├── cng-magazine-layout/     规格来源（含栅格 SVG 与生成脚本）
│   ├── layout-qc/               成品验收（SKILL + 3 参考 + 7 脚本）
│   └── web-research/            联网检索（SKILL + 2 脚本）
├── docs/
│   ├── AGENTS.md                项目指令模板（把这份放进你的项目根目录）
│   └── workflow-zh.md           给使用者看的工作流说明
└── examples/
    ├── piece.example.json       单篇版式配置示例
    └── layout.example.json      多页多版式配置示例
```

## 快速开始

见 [INSTALL.md](INSTALL.md)。最短路径：

```powershell
# 1) 把 skills/ 下的目录复制到你的 Codex 技能目录
Copy-Item .\skills\* "$HOME\.codex\skills\" -Recurse -Force

# 2) 进你的杂志项目目录，把 docs/AGENTS.md 复制成 AGENTS.md（并按你的项目改路径）

# 3) 之后只需给素材与需求，工作流会：
#    解析源文 → 生成背景（自动校准对比度）→ 版式引擎排版 → 六项验收 → 交付四件套
```

交付物固定为四件：**印刷 PDF**（CMYK + 3mm 出血，TrimBox = 成品尺寸）+
**可编辑 .indd** + **300dpi 预览** + 需要的**局部放大图**。

## 已知边界

- 版式引擎目前提供 8 种 pattern；不匹配的形态需要**临时写一个 `pat_xxx` 函数**
  （引擎的 dispatch 只加一个分支，不影响其它版式）。
- 依赖 Adobe InDesign 桌面版（通过 COM / ExtendScript 驱动），Windows 环境实测；
  macOS 的 AppleScript 通道代码在，但未做实测。
- 官方 OpenAI 文档在部分网络环境不可达；`web-research` 技能里记录了哪些通道可用、哪些不可用。
- 我们**没有**在开源生态里找到可复用的"印刷成品质检闭环"，这部分（layout-qc）是自研的。

## 来源与致谢

- 规格来源：相关刊物的官方广告刊例（页边距、栏格、图片像素表、总墨量等）；
- 中文排印规则：W3C《中文排版需求》clreq（中西文间距 ≤1/4 汉字宽、禁则"先挤进后推出"、行距 ≥1.5 倍等）；
- 审美与工程实践：吸收并改写了多个开源设计 skill 的可迁移原则
  （`refactoring-ui-skill`、`premium-design-skill`、`huashu-design`、`SDesign`、`ui-aesthetics`、
  `taste-skill`、`chinese-font-selector`、`chart-aesthetic-logic`、`gzh-design-skill`、`zine-composition-beauty` 等），
  每个技能的 `references/sources.md` 里记录了**吸收了什麼、有意排除了什麼**。

## 许可

MIT（见 [LICENSE](LICENSE)）。第三方来源的授权以各自仓库为准，详见 `sources.md`。
