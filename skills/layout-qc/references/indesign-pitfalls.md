# InDesign 自动化已知坑

用 MCP / ExtendScript 驱动 InDesign 时的实测坑，按踩坑顺序排列。

## 单位

- `documentPreferences.pageWidth/pageHeight` 的单位**跟随文档标尺单位**（默认毫米），不是磅。
  传 `297 * 2.8346 = 841.89` 想要 A3，实际会得到 A0（841.89 mm）。写 `dp.pageWidth = 297` 才对。
- 但 `geometricBounds`（矩形、文本框的坐标）**始终是磅**，与标尺单位无关。两者混用是最容易出错的地方。
- 稳妥写法：先 `app.scriptPreferences.measurementUnit = MeasurementUnits.MILLIMETERS` 设页面尺寸，再切回 POINTS 摆对象。
- 验证手段：导出后量 `像素 / DPI`，反推物理尺寸。不要靠读 API 返回值判断。

## 字体

- 设置字体要用**复合名**：`story.appliedFont = "家族名" + String.fromCharCode(9) + "样式名"`（制表符分隔）。
  只设 `appliedFont = "家族名"` 再设 `fontStyle = "Bold"` 会报「请求的字体样式不可用」。
- InDesign **只在启动时扫描字体**。装完新字体必须重启 InDesign，否则字体不可见，静默回退到默认字体。
- 枚举字体：`app.fonts` 的属性是 `fontFamily`（不是 `family`），家族+样式去重后再展示。
- 中文字体家族名可能是本地化名称（如「微软雅黑」）也可能是西文名（如「Noto Sans SC (OTF)」），枚举后按实际名称使用。

### 回读不等于生效（本机实测）

`parentStory.appliedFont.name` 回读正常**不代表渲染时真用了这款字体**。实测：把中文标题设成
`Noto Sans SC (OTF)\tBlack`，回读一切正常，但导出的 PDF 里内嵌的是 **SimSun**——排版软件静默回退了，
而 JPG 导出在外观上未必立刻看得出来。

唯一可靠的验证方式是看导出物的内嵌字体名：

```
powershell -ExecutionPolicy Bypass -File scripts/list-pdf-fonts.ps1 -Path 成品.pdf
```

本机（InDesign 21.4.1.4 / Windows）实测结果：

| 字体 | 设成中文标题后 PDF 内嵌 | 结论 |
| --- | --- | --- |
| 微软雅黑 Regular / Bold / Light | MicrosoftYaHei / -Bold / Light | 生效 |
| 等线 Light / Regular / Bold | DengXian-Light / DengXian / DengXian-Bold | 生效 |
| 黑体、宋体 | SimHei / SimSun | 生效 |
| 方正舒体、方正姚体 | FZSTK--GBK1-0 / FZYTK--GBK1-0 | 生效 |
| 华文宋体 | STSong | 生效 |
| Noto Sans SC (OTF) | SimSun | **静默回退，不可用** |

结论：这台机器上要排中文，优先用微软雅黑 / 等线；Noto 与 Source Han 系列在 InDesign 里不可靠。

## 卡死与恢复

- 若排版软件对字体有疑问，会弹出**模态警告**；此时它的主线程不再处理消息，
  任何 ExtendScript / MCP 调用都会超时（表现为 `spawnSync ... ETIMEDOUT`）。
- 判定：`Get-Process InDesign | Select Responding` 若长期为 `False`，基本可确认被模态框或异常状态卡住。
- **不要靠发按键或 `PostMessage` 去关它**：主线程不处理消息时，`SendMessage` 会把调用方一起卡死
  （同步等待永不返回），`PostMessage` 也不会被处理。唯一可行的恢复是结束进程后重启。
- `taskkill /F` 后要**确认进程真的消失**再启动新实例，否则 COM 可能连到挂起的旧实例，继续超时。
- 预防：一次脚本里不要连续导出十几个文件（容易触发警告并累积），分批执行并在每批之后量一次导出物。

## 导出

- `app.jpegExportPreferences.exportResolution` 的单位换算取决于文档尺寸单位；**每次改完页面尺寸都要重新验证导出件的像素数**。
- 导出前先删旧文件（`File.remove()`），否则旧文件会让人误判"导出成功"。
- `pageString = '1'` 明确指定导出页，避免多页文档导错页。
- 导出后立刻量尺寸，这是一次成本极低、收益极高的检查。

## ExtendScript 语法

- `textFramePreferences` 没有 `insetTop/insetBottom`，用 `insetSpacing = [上, 左, 下, 右]`。
- `FirstBaselineOffset` 等枚举在部分版本不可用，不确定就别设，用默认值。
- 避免 ES6+ 语法（箭头函数、`const/let`、模板字符串），ExtendScript 引擎不支持。

## 视觉模型配合

- 用视觉模型复核成品时，只让它**转录文字**和**描述元素**；比例、尺寸、对齐一律自己量。
- 提问要明确「看不清就说看不清」，否则它会补全不存在的字。
- 这些模型是推理模型：`max_tokens` 给太小，思维链会吃掉全部额度并返回空内容。
