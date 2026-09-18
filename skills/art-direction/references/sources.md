# 吸收来源与对应关系

本 skill 是**提炼**，不是搬运：只吸收可迁移到实际生产的判断原则，丢弃仅适用于特定技术栈的实现细节。

| 来源（GitHub） | 吸收了什麼 | 有意排除 |
| --- | --- | --- |
| `kasonye/ui-aesthetics-skill` | 优先级顺序、范围纪律、克制原则、"灰度下是否成立"判据、反模式清单、自检问句 | 状态/动效/阴影模糊等纯屏幕机制 |
| `alchaincyf/huashu-design` | 反 slop 的成因逻辑与破例边界、资产 > 规范、诚实占位、给变体而非单一答案、品牌资产协议 | HTML/React 工具链、Gate 文件协议、动效水印 |
| `simonlin1212/SDesign` | 去 AI 味硬规则、"一次只用一套美学"、风格家族式路由的思路 | 64 套 CSS token、品牌仿制清单 |
| `Leonxlnx/taste-skill`（minimalist / brutalist 等） | 字体层级与字距的极端要求、负向约束（禁默认字体、禁滥用圆角与阴影）、"一次只选一种模式" | 具体色值与组件规格 |
| `zhaiyateng/dsh-design-skills` | 风格互斥性、风格原型命名法 | 10 套屏幕风格的具体样式 |
| `Songzhi-lab/chinese-font-selector` | 授权分级、场景×气质选字、中英混排、字号阶梯与行距、方案输出模板 | 其字体数据库全文（需要时直接查原库） |
| `ink7011/zine-composition-beauty` | 编辑拼贴手法（照片作结构、负空间延续、单一强调色、极小注记） | 具体图像生成提示词模板 |

## 第二批（screen-ui 扩写与原则补强）

| 来源（GitHub） | 吸收了什麼 | 有意排除 |
| --- | --- | --- |
| `luukalleman/premium-design-skill` | 五条主张（字体是主角／动效必须有意图／层次靠叠层不靠阴影／色彩克制而构图自信／有意断网格）、近白近黑与材料感强调色的取法 | Tailwind 类名、framer-motion 用法、字体采购清单 |
| `ConardLi/garden-skills`（beautiful-article） | **质检分级**（按节点决定用独立审查还是内联自查，避免过度质检）、**三视角终审**（编辑／视觉／技术）、"拿到结论先修完再汇报"的铁律、禁止静默替用户决策 | reacticle 组件协议、HTML 工作流脚手架 |
| `nextlevelbuilder/ui-ux-pro-max-skill`（design-system / ui-styling / banner-design） | 六类设计 token 的清单化思路、组件与状态纪律、横幅与社媒尺寸速查表、艺术方向清单 | 具体 CSS 实现与组件库代码 |
| `geekjourneyx/claude-design-card` | "先定成品规格再动手"的决策表思路、字号随格式缩放的做法 | 14 种格式的具体数值、Playwright 截图流程 |

## 第三批（2026-09-18，联网后重检索）

| 来源（GitHub） | 吸收了什麼 | 有意排除 |
| --- | --- | --- |
| `s0xDk/refactoring-ui-skill`（555★，《Refactoring UI》规则化） | **从尺度取值**（间距尺度相邻值差 ≥25%、字号用常见号数而非算小数）、层级靠字重与颜色而非只靠字号、中性灰成套、颜色用色相+明度思维、行长 45–75 西文字符（≈中文 25–35 字，与本 skill 的区间互相印证） | CSS 阴影五档、圆角 px 值、`em/rem` 讨论等屏幕专有内容 |
| `Wunrry/chart-aesthetic-logic`（7★） | **信号经济**与**视觉诚实**两条判断镜头、上色前的五类结构审计、色板按数据语义选择（名义/有序/发散/周期）、避开彩虹与 jet、洞见式标题 vs 描述性标题 | Matplotlib/Seaborn/Plotly/TikZ 的工具选择与依赖管理 |
| `isjiamu/gzh-design-skill`（3732★） | **强调配给制**（锚点层全文 ≤5 处、标记层每段 1–3 处）、图片按原生比例不拉伸、不硬造图注、一篇文章只用一套主题组件、"目录是精选不是全量"、原文内容不得增删 | 公众号平台红线（`<span leaf>` 包裹等）、HTML 主题库 |
| `mathruffian-dot/yaml-image-deck`（10★） | **风格锁定 / golden-sample**：首件定样、后续照抄参数 | YAML 与图片幻灯片的生成流程 |
| `Wholiver/swiftui-design-skill`（198★） | 设计方向工作流（先给 3 个方向 + 视觉锚点再让用户选）——与本 skill 的"给变体不给最终答案"一致，作为交叉印证 | SwiftUI 组件与 iOS 专有规范 |
| `Gakusyun/typst-author-chinese`（9★） | 中文排版的实现要点已由 clreq 覆盖，本 skill 无新增 | Typst 语法与 CLI |

授权与归属说明：以上来源的授权条款以其各自仓库为准（部分为 MIT / Apache-2.0 / OFL 混合）。
本文件中的文字为重新组织的原则性表述，不逐字复制原文件；如要引用原文请回到对应仓库。

## 与 `layout-qc` 的分工

- `art-direction`（本 skill）：**做之前怎么想、做完怎么评审**——判断与决策
- `layout-qc`：**成品怎么量**——像素尺寸、版面带、文字包围盒、PDF 内嵌字体取证

两者不重叠：本 skill 不量数据，layout-qc 不做审美判断。
