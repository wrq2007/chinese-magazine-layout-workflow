// 刊物骨架生成器：对页文档 + 出血 + 母版页码/页眉 + 栏网格 + 每页占位框 + 导出 PDF
// 在 InDesign 里通过 ExtendScript 执行；改 CONFIG 即可换开本/页数/栏数。
//
// 单位约定（重要，踩过的坑）：
//   scriptPreferences.measurementUnit 决定的不只是坐标，**字号/行距也跟随它**。
//   - 若设为毫米而字号写 33（本意 33pt），会被当成 33mm，文字直接溢出到框外看不见；
//   - 若单位是毫米却把「毫米 × 2.8346」当磅传，坐标会被当成毫米，对象被丢到页面外的粘贴板。
//   本脚本统一用**磅**：单位设为 POINTS，坐标一律用 P(mm) 换算，字号/行距直接写磅值。

var CONFIG = {
  pageWidthMm: 210,
  pageHeightMm: 297,
  pageCount: 8,
  facingPages: true,
  bleedMm: 3,
  marginTopMm: 18,
  marginBottomMm: 20,
  marginInsideMm: 18,
  marginOutsideMm: 14,
  columns: 3,
  gutterMm: 5,
  bodyFont: '微软雅黑' + String.fromCharCode(9) + 'Regular',
  titleFont: '微软雅黑' + String.fromCharCode(9) + 'Bold',
  outPdf: 'C:/Users/YOUR_NAME/Documents/Codex/2026-09-16/di-y/work/magazine-skeleton.pdf',
  label: 'MagazineSkeleton'
};

var MM = 2.8346456693;
var report = [];

function P(mm) { return mm * MM; }   // 毫米 → 磅

// 跨页文档里，右页对象的 x 坐标要加上它在跨页内的偏移（一个页宽）。
// 不用 page.bounds[1]：在部分版本/状态下它不可靠。
function pageOffsetPt(pageIndex) {
  if (!CONFIG.facingPages) { return 0; }
  if (pageIndex === 0) { return 0; }                 // 第 1 页单独成跨页
  return (pageIndex % 2 === 1) ? 0 : P(CONFIG.pageWidthMm);  // 偶数索引(0基) = 右页
}

// 清掉同名旧文档
for (var i = app.documents.length - 1; i >= 0; i--) {
  if (app.documents[i].label === CONFIG.label) { app.documents[i].close(SaveOptions.NO); }
}

app.scriptPreferences.measurementUnit = MeasurementUnits.POINTS;
var doc = app.documents.add();
var dp = doc.documentPreferences;
dp.pageWidth = P(CONFIG.pageWidthMm);
dp.pageHeight = P(CONFIG.pageHeightMm);
dp.facingPages = CONFIG.facingPages;
dp.pagesPerDocument = CONFIG.pageCount;
dp.documentBleedUniformSize = true;
dp.documentBleedTopOffset = P(CONFIG.bleedMm);

// 每个页面文档统一边距（内/外侧在单页上先取一致，装订余量留在这里）
for (var p = 0; p < doc.pages.length; p++) {
  var mp = doc.pages[p].marginPreferences;
  var isRight = (p % 2 === 0);   // 对页文档第 1 页为右页
  mp.top = P(CONFIG.marginTopMm);
  mp.bottom = P(CONFIG.marginBottomMm);
  mp.left = P(isRight ? CONFIG.marginInsideMm : CONFIG.marginOutsideMm);
  mp.right = P(isRight ? CONFIG.marginOutsideMm : CONFIG.marginInsideMm);
}

// 母版：页码（外侧下角）+ 页眉横线
var master = null;
try {
  master = doc.masterSpreads.add({ namePrefix: 'A', baseName: '正文' });
  report.push('母版: 已创建 ' + master.namePrefix + '-' + master.baseName);
} catch (e) {
  report.push('母版: 创建失败，退回逐页页码 — ' + e.message);
}

function addPageNumber(pageItem, xMm, yMm) {
  var tf = pageItem.textFrames.add({ geometricBounds: [P(yMm), P(xMm), P(yMm + 6), P(xMm + 40)] });
  tf.contents = SpecialCharacters.AUTO_PAGE_NUMBER;
  var st = tf.parentStory;
  st.appliedFont = CONFIG.bodyFont;
  st.pointSize = 8;
  st.fillColor = doc.swatches.itemByName('Black');
  st.justification = Justification.LEFT_ALIGN;
  return tf;
}

if (master !== null) {
  for (var m = 0; m < master.pages.length; m++) {
    var isRightMaster = (m % 2 === 0);
    var xNum = isRightMaster ? CONFIG.marginOutsideMm : (CONFIG.pageWidthMm - CONFIG.marginOutsideMm - 40);
    addPageNumber(master.pages[m], xNum, CONFIG.pageHeightMm - CONFIG.marginBottomMm + 6);
  }
  // 关键：母版必须逐页应用，否则页码不会出现在页面上
  for (var a = 0; a < doc.pages.length; a++) { doc.pages[a].appliedMaster = master; }
  report.push('母版页码: ' + master.pages.length + ' 个位置，已应用到 ' + doc.pages.length + ' 页');
}

// 每页占位文本框（按栏切分），后续内容脚本直接往这些框里灌文字
var colWidthMm = (CONFIG.pageWidthMm - CONFIG.marginInsideMm - CONFIG.marginOutsideMm - CONFIG.gutterMm * (CONFIG.columns - 1)) / CONFIG.columns;
var textTopMm = CONFIG.marginTopMm + 30;   // 给每页顶部标题+副标题留出空间（标题区必须整段落在本值之上）
var textBottomMm = CONFIG.pageHeightMm - CONFIG.marginBottomMm;

for (var pg = 0; pg < doc.pages.length; pg++) {
  var page = doc.pages[pg];
  var xStartMm = (pg % 2 === 0) ? CONFIG.marginInsideMm : CONFIG.marginOutsideMm;
  for (var c = 0; c < CONFIG.columns; c++) {
    var x0 = xStartMm + c * (colWidthMm + CONFIG.gutterMm);
    var xOff = pageOffsetPt(pg);   // 右页需要加上它在跨页内的 x 偏移（磅）
    var frame = page.textFrames.add({
      geometricBounds: [P(textTopMm), xOff + P(x0), P(textBottomMm), xOff + P(x0 + colWidthMm)]
    });
    frame.label = 'col-' + (c + 1);
  }
}
report.push('栏网格: ' + CONFIG.columns + ' 栏 / 栏宽 ' + Math.round(colWidthMm * 10) / 10 + 'mm / 共 ' + doc.pages.length + ' 页');

// 导出 PDF（字体嵌入走默认设置）
var f = new File(CONFIG.outPdf);
if (f.exists) { f.remove(); }
app.pdfExportPreferences.pageRange = '全部';
app.pdfExportPreferences.useDocumentBleedWithPDF = true;   // 导出带出血，否则印刷裁切会露白
doc.exportFile(ExportFormat.PDF_TYPE, f, false);
report.push('PDF: ' + f.exists + ' | ' + (f.exists ? f.length : 0) + ' bytes');

doc.label = CONFIG.label;
report.push('文档: ' + doc.name + ' | 页数=' + doc.pages.length);
report.join('\n');
