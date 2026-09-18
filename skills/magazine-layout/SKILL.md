---
name: magazine-layout
description: 多页刊物的结构与系统搭建——杂志、画册、年报、特刊的开本页数规划、母版与样式体系、文章流、目录页码、跨页节奏与印前交付。用于"做一本杂志/画册/多页刊物""把内容排成刊物""这本刊怎么搭"这类多页排版任务；单页海报或单图只做审美判断时用 art-direction，成品量化验收用 layout-qc。
---

# 多页刊物结构（magazine-layout）

## 规格以 cng 为准（本 skill 不管数值）

开本、版心、栏格、字号阶梯、素材分辨率、总墨量这些**生产数值**统一由 skill **`cng-magazine-layout`** 提供
（它有《中国国家地理》官方刊例做来源，可随时按项目调整）。本 skill 只管**结构与内容层规范**：
页数与栏目规划、母版与样式体系、文章流、跨页节奏、版式引擎，以及 `references/text-rules.md` 里的内容层排印规则。

当前项目默认值（来自 cng skill，规格可变，先按它做）：185×260mm、出血 3mm、四色胶装、175 线、
版心 上18/下22/内20/外16（149×220mm）、基准 6 栏（19+7）、正文 9pt/14pt、图注 8.5pt、素材按 350dpi 备料。

## 立场

多页刊物和单页海报是两件事：海报靠构图，**刊物靠系统**。
先立标准（开本、母版、样式、网格），再灌内容。顺序颠倒 = 每页都要手调 = 必然不一致。

## 流程（顺序执行，不要跳步）

1. **定开本与页数** —— 页数受装订约束（骑马订必须 4 的倍数，胶装按印张），先算再排。见 `references/structure.md`
2. **定三套系统** —— 母版（页码/页眉/页脚）、段落样式（标题到图注全部命名）、网格（栏数/基线/边距）。见 `references/master-and-styles.md`
3. **排文章流** —— 一篇文章一条文本流，跨页自动续排；禁止用空行/空格推版
4. **目录与页码** —— 目录页码与内文实际页码一致；页码只走母版，不手打
5. **节奏检查** —— 每 4–8 页给一次版式变奏（跨页图/留白页/大字页），避免通篇同构
6. **印前** —— 出血、分辨率、字体嵌入、色彩与总墨量。见 `references/production.md`
7. **交付验收** —— 用 `layout-qc` 逐页量测 + PDF 内嵌字体取证，不靠肉眼

## 铁律

- **先系统后内容**：母版/样式没立好就开始排文字，返工代价最高。
- **页码、页眉、页脚只出现在母版上**。手打页码的刊物一定会在改版后错页。
- **一篇文章 = 一条文本流**（story）。拆成多个独立文本框后，改一个字都可能压掉一页。
- **母版改动是全局改动**：动母版前先确认会影响多少页。
- **页数一旦变化，目录与页码必须重核**——这是刊物最常见的低级错误。
- 图注必须与图同页；跨页图必须左右出血连续。

## InDesign 操作要点

- 文档：勾选**对页（facing pages）**、出血 3mm（按印厂要求）、页数一次给足。
- 母版：在母版上加页码文本框，内容用**自动页码符号**（ExtendScript 里是 `SpecialCharacters.AUTO_PAGE_NUMBER`），不要手打数字。
- 文本框链：`frame.nextTextFrame = nextFrame` 建立续排；用"自动排文"灌入长文。
- 样式：所有文字都套段落样式；禁止直接改选中文字的字号（会制造"样式外属性"）。
- 验证：导出 PDF 后用 `layout-qc/scripts/list-pdf-fonts.ps1` 确认字体真的嵌入（"回读不等于生效"）。

## 脚本

### 版式引擎（推荐入口）

`scripts/build-layout.jsx` —— **pattern 驱动的排版引擎**：按配置逐页调用版式模式，自动串文、自动处理图片格位、自动自查。

可用 pattern（配置里按页调用）：

| pattern | 用途 | 关键参数 |
| --- | --- | --- |
| `cover` | 满版图封面 | `image` `kicker` `title` `sub` |
| `text` | 文字页（可多栏、可跨页串文） | `columns` `flowStart` `title` |
| `plate` | 满版图版页 | `image` `caption` |
| `imageText` | 图文页（上图下文 / 左图右文） | `image` `imageSide` `imageHeightMm` `title` |
| `quote` | 引文页 | `text` `source` `image`(可选作底) |
| `toc` | 目录页（页码右对齐） | `items`（`[条目, 页码]` 数组） |
| `signature` | 署名（三级递减、右对齐） | `lines` `layout` |
| `blank` | 留白页（节奏换气） | — |

配置结构：`design`（开本/边距/栏格/字体字号/颜色）+ `assets`（图片 id → 路径，相对路径按 workDir 解析）+ `pages[]`（逐页 pattern 实例）+ `flowText`（正文段落范围，一段只灌一次）。
示例见 `scripts/piece.example.json`。

**新增一种版式**：写一个 `pat_<名字>(pageIdx, spec)` 函数（内部用 `txt()` / `rect()` / `img()` 画），再在渲染循环里加一个分支即可——不用改动其它 pattern。

### 一条命令的流水线

`scripts/make-piece.ps1` 串起全流程：背景（自动校准对比度）→ 解析源文 → 排版 → 合成预览与局部图 → 规格检查 → 逐字比对，并输出各步耗时。

配套脚本：

| 脚本 | 作用 |
| --- | --- |
| `make-background.ps1` | 裁切 → 模糊 → 渐变遮罩 → 暗部提亮 → **自动对比度校准**（逐级加码直到达标，省掉人工试错）→ 切分左右页 |
| `extract-text.py` | 源文（docx/md/txt）→ 段落数组 + 全文；**文本不经过人手，避免重打丢字符** |
| `build-piece.jsx` | 单篇版式（旧的单形态路径，保留兼容） |
| `build-layout.jsx` | 多图多版式引擎（推荐） |

`scripts/magazine-skeleton.jsx` —— 一次生成刊物骨架：对页文档、出血、母版页码与页眉、栏网格、每页占位文本框、导出 PDF。
脚本顶部的 `CONFIG` 区块可改开本、页数、边距、栏数。用法：

```
node <运行器> scripts/magazine-skeleton.jsx
```

骨架跑通后再用第二个脚本灌内容——这正是真实刊物的两步工作流。

## 排完必做

排完/灌完内容后、导出前，跑一遍 `layout-qc/scripts/check-overlap.jsx`（框重叠）
、`layout-qc/scripts/check-cjk-typography.jsx`（中文排印规范：避头尾／标点／缩进／中西文字体／行宽）
与 `layout-qc/scripts/measure-export.ps1`（尺寸与版面量测）。
多页刊物出过的错（标题压正文、页码不出现、对象跑到粘贴板）见 `layout-qc/references/mistakes-log.md`。

**文本不变式（比任何检查都重要）**：正文内容一律**只复制粘贴**——由脚本从源文件读入、原样流入排版，
**不得增加、删除、修改任何字符**（含标点、空格、数字、特殊符号）。守住这一条，文本就不需要事后比对。

**建议把检查串进导出流程**：写一个 `build.ps1` 之类的一键脚本，按「生成骨架 → 灌内容 → 导出 → 自动跑检查」的顺序执行，
把框重叠、PDF 内嵌字体、版面规则（`check-layout-rules.ps1`）三项结果打在同一个输出里。
好处是"导出即验收"，不会出现"导完就交付、忘了量"的情况。

注意：这类脚本含中文时**必须存成 UTF-8 with BOM**，否则 Windows PowerShell 5.1 会按 ANSI 解析导致语法错误（见 `layout-qc/references/mistakes-log.md` 的 B11）。

## 与其他 skill 的分工

- `art-direction`：审美与版式判断（用什么风格、版式怎么好看）
- **本 skill**：多页结构（页数、母版、样式、文章流、页码、印前）
- `layout-qc`：成品量化验收（尺寸、色带、文字包围盒、内嵌字体）

## 参考

- [references/text-rules.md](references/text-rules.md) — **内容层排印规范**（标题/正文/图注/数字/标点/断行/署名），内容质量看这份
- [references/structure.md](references/structure.md) — 开本与页数规划、装订方式、页面节奏
- [references/master-and-styles.md](references/master-and-styles.md) — 母版体系、样式命名、网格与基线、文章流
- [references/production.md](references/production.md) — 印前交付清单、拼版与装订基础
