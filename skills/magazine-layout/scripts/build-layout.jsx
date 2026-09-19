// 版式引擎（pattern 驱动）：按配置逐页调用版式模式，自动串文、自动处理图片格位、自动自查
//
// 配置结构（layout.json）：
//   design  : 全局设计系统（开本/出血/页数/边距/栏格/字体/字号/颜色）
//   assets  : 图片清单（id → 文件路径）；图片按格位比例自动裁切填充
//   pages[] : 每页一个 pattern 实例；带 flow:true 的文字页会依次串成一条文本流
//   text    : 文本来源（paragraphs.json 的段落索引范围）
//
// 可用 pattern：
//   cover      满版图封面（眉标 + 大标题 + 副题）
//   text       文字页（可多栏、可跨页串文）
//   plate      满版图版页（图 + 图注）
//   imageText  图文页（上图下文 / 左图右文）
//   quote      引文页（大字引文 + 出处）
//   toc        目录页（条目 + 页码，页码独立右对齐）
//   blank      留白页（节奏换气）
//
// 新增版式的方法：写一个 pat_<名字>(page, spec) 函数，在里面用 txt()/rect()/img() 画，
// 然后在 build 的 dispatch 里加一个分支即可——不改动其它 pattern。
app.scriptPreferences.measurementUnit = MeasurementUnits.POINTS;
var MM = 2.8346456693;
function P(mm) { return mm * MM; }
var TAB = String.fromCharCode(9), CR = String.fromCharCode(13);
var report = [], t0 = new Date().getTime();

var cfgFile = new File('E:/杂志/序言/_build/layout.json');
if (!cfgFile.exists) { 'CONFIG_NOT_FOUND: ' + cfgFile.fsName; }
else {
  cfgFile.encoding = 'UTF-8'; cfgFile.open('r');
  var cfg = eval('(' + cfgFile.read() + ')'); cfgFile.close();

  var paragraphs = [];
  if (cfg.paragraphsJson) {
    var pf = new File(cfg.paragraphsJson); pf.encoding = 'UTF-8'; pf.open('r');
    paragraphs = eval('(' + pf.read() + ')'); pf.close();
  }

  var D = cfg.design, page = D.page, MG = D.margins, TY = D.type, CO = D.colors;
  // 输出/工作目录不存在时自行创建（避免 InDesign 报"找不到文件夹"）
  var fOut = new Folder(cfg.outDir); if (!fOut.exists) { fOut.create(); }
  var fWork = new Folder(cfg.workDir); if (!fWork.exists) { fWork.create(); }
  var textW = page.widthMm - MG.inside - MG.outside;
  var colCount = (D.grid && D.grid.columns) || 1;
  var gutter = (D.grid && D.grid.gutterMm) || 5;

  var prevActiveName = '';
  try { if (app.documents.length > 0) { prevActiveName = app.activeDocument.name; } } catch (e) { }
  for (var i = app.documents.length - 1; i >= 0; i--) {
    if (app.documents[i].label === cfg.label) { app.documents[i].close(SaveOptions.NO); }
  }

  var doc = app.documents.add();
  doc.label = cfg.label;
  var dp = doc.documentPreferences;
  dp.pageWidth = P(page.widthMm); dp.pageHeight = P(page.heightMm);
  dp.facingPages = false; dp.pagesPerDocument = cfg.pages.length;
  dp.documentBleedUniformSize = true; dp.documentBleedTopOffset = P(page.bleedMm);
  for (var pp = 0; pp < doc.pages.length; pp++) {
    var mp = doc.pages[pp].marginPreferences;
    var isRight = (pp % 2 === 0);
    mp.top = P(MG.top); mp.bottom = P(MG.bottom);
    mp.left = P(isRight ? MG.inside : MG.outside);
    mp.right = P(isRight ? MG.outside : MG.inside);
  }
  function pageX(pageIndex) { return (pageIndex % 2 === 0) ? MG.inside : MG.outside; }

  function getColor(name, rgb) {
    var c = doc.colors.itemByName(name);
    if (c.isValid) { return c; }
    return doc.colors.add({ name: name, model: ColorModel.PROCESS, space: ColorSpace.RGB, colorValue: rgb });
  }
  var cText = getColor('LayText', CO.text);
  var cAccent = getColor('LayAccent', CO.accent);
  var cMuted = getColor('LayMuted', CO.muted);
  var cDim = getColor('LayDim', CO.dim);
  var none = doc.swatches.itemByName('None');

  function txt(pg, b, content, family, style, size, leading, color, tracking, just) {
    var tf = pg.textFrames.add({ geometricBounds: [P(b[0]), P(b[1]), P(b[2]), P(b[3])] });
    var st = tf.parentStory;
    st.appliedFont = family + TAB + style;
    st.pointSize = size; st.leading = leading; st.fillColor = color;
    st.tracking = tracking; st.hyphenation = false; st.justification = just;
    tf.textFramePreferences.insetSpacing = [0, 0, 0, 0];
    tf.contents = content;
    return tf;
  }
  function rect(pg, b, fill, label) {
    var rc = pg.rectangles.add({ geometricBounds: [P(b[0]), P(b[1]), P(b[2]), P(b[3])] });
    rc.fillColor = fill; rc.strokeWeight = 0; rc.strokeColor = none;
    if (label) { rc.label = label; }
    return rc;
  }
  // 图片：按格位比例自动裁切填充（cover）；可选对齐焦点
  function img(pg, b, file, label) {
    var rc = pg.rectangles.add({ geometricBounds: [P(b[0]), P(b[1]), P(b[2]), P(b[3])] });
    rc.place(File(file));
    rc.fit(FitOptions.FILL_PROPORTIONALLY);
    rc.fit(FitOptions.CENTER_CONTENT);
    rc.strokeWeight = 0; rc.strokeColor = none;
    if (label) { rc.label = label; }
    return rc;
  }
  function assetPath(id) {
    var a = cfg.assets[id];
    if (!a) { return ''; }
    // 绝对路径（盘符或前导斜杠）直接用；相对路径一律相对 workDir 解析
    var isAbs = /^[A-Za-z]:[\\\/]/.test(a) || a.charAt(0) === '/' || a.charAt(0) === '\\';
    return isAbs ? a : (cfg.workDir + '/' + a);
  }
  function paras(range) {
    if (!range || !paragraphs.length) { return []; }
    var from = range[0], to = (range[1] === undefined || range[1] < 0) ? paragraphs.length - 1 : range[1];
    var out = [];
    for (var k = from; k <= to && k < paragraphs.length; k++) { out.push(paragraphs[k]); }
    return out;
  }

  // ---------------- 版式模式 ----------------
  function pat_cover(pageIdx, spec) {
    var pg = doc.pages[pageIdx];
    if (spec.image) { img(pg, [-page.bleedMm, -page.bleedMm, page.heightMm + page.bleedMm, page.widthMm + page.bleedMm], assetPath(spec.image), 'bg'); }
    if (spec.band !== false) { rect(pg, [page.heightMm - 96, 0, page.heightMm, page.widthMm], getColor('LayBand', CO.band), 'band'); }
    var x = pageX(pageIdx);
    if (spec.kicker) { txt(pg, [page.heightMm - 84, x, page.heightMm - 74, x + textW], spec.kicker, TY.sansFont, 'Regular', TY.kickerPt, TY.kickerPt * 1.4, cMuted, 200, Justification.LEFT_ALIGN); }
    txt(pg, [page.heightMm - 68, x, page.heightMm - 20, x + textW], spec.title, TY.titleFont, 'Regular', TY.titlePt, TY.titlePt * 1.2, cText, 30, Justification.LEFT_ALIGN);
    if (spec.sub) { txt(pg, [page.heightMm - 16, x, page.heightMm - 4, x + textW], spec.sub, TY.sansFont, 'Regular', TY.kickerPt + 1, (TY.kickerPt + 1) * 1.5, cMuted, 120, Justification.LEFT_ALIGN); }
    return '封面';
  }

  function pat_text(pageIdx, spec, flowFrames) {
    var pg = doc.pages[pageIdx], x = pageX(pageIdx);
    var cols = spec.columns || colCount;
    var cw = (textW - gutter * (cols - 1)) / cols;
    // 行宽自检：中文一行字数 = 栏宽 ÷ (字号 × 0.3528)。低于 22 字或高于 40 字都要提醒
    var perLine = Math.round(cw / ((spec.bodyPt || TY.bodyPt) * 0.3528));
    if (perLine < 22 || perLine > 40) {
      report.push('★ 行宽提醒：P' + (pageIdx + 1) + ' ' + cols + ' 栏 × ' + Math.round(cw) + 'mm ≈ ' + perLine +
        ' 字/行（舒适区 25–35）——建议改为 ' + Math.max(1, Math.round(textW / 100)) + ' 栏或调整字号');
    }
    var top = spec.title ? MG.top + 26 : MG.top;
    if (spec.title) { txt(pg, [MG.top, x, MG.top + 14, x + textW], spec.title, TY.sansFont, 'Bold', 20, 26, cText, 30, Justification.LEFT_ALIGN); }
    var made = [];
    for (var c = 0; c < cols; c++) {
      var x0 = x + c * (cw + gutter);
      var f = pg.textFrames.add({ geometricBounds: [P(top), P(x0), P(page.heightMm - MG.bottom), P(x0 + cw)] });
      f.label = 'body'; made.push(f);
    }
    // 串文：整篇正文只灌一次——由 cfg.flowText 指定范围，且只灌在该流的第一页
    if (spec.flow !== false) { for (var m = 0; m < made.length; m++) { flowFrames.push(made[m]); } }
    var isFlowStart = (spec.flowStart === true) || (spec.textRange && !spec.flow);
    if (isFlowStart) {
      var range = spec.textRange || cfg.flowText;
      made[0].contents = paras(range).join(CR);
      var st = made[0].parentStory;
      st.appliedFont = TY.bodyFont + TAB + 'Regular';
      st.pointSize = spec.bodyPt || TY.bodyPt; st.leading = spec.leadingPt || TY.leadingPt;
      st.fillColor = cText; st.firstLineIndent = (spec.bodyPt || TY.bodyPt) * 2;
      st.hyphenation = false; st.spaceBefore = 0;
    }
    return '文字页' + (made.length > 1 ? '（' + cols + '栏）' : '');
  }

  function pat_plate(pageIdx, spec) {
    var pg = doc.pages[pageIdx];
    var capH = spec.caption ? 26 : 0;
    img(pg, [-page.bleedMm, -page.bleedMm, page.heightMm - capH + page.bleedMm, page.widthMm + page.bleedMm], assetPath(spec.image), 'bg');
    if (spec.caption) { txt(pg, [page.heightMm - capH + 6, MG.inside, page.heightMm - MG.bottom + 6, MG.inside + textW], spec.caption, TY.sansFont, 'Regular', 8.5, 13, cText, 40, Justification.LEFT_ALIGN); }
    return '图版页';
  }

  function pat_imageText(pageIdx, spec) {
    var pg = doc.pages[pageIdx], x = pageX(pageIdx);
    var side = spec.imageSide || 'top';
    if (side === 'top') {
      var h = spec.imageHeightMm || 140;
      img(pg, [0, 0, h, page.widthMm], assetPath(spec.image), 'bg');
      txt(pg, [h + 10, x, MG.top + h + 24, x + textW], spec.title || '', TY.sansFont, 'Bold', 18, 24, cText, 30, Justification.LEFT_ALIGN);
      txt(pg, [h + 30, x, page.heightMm - MG.bottom, x + textW], paras(spec.textRange).join(CR), TY.bodyFont, 'Regular', TY.bodyPt, TY.leadingPt, cText, 0, Justification.LEFT_ALIGN).parentStory.firstLineIndent = TY.bodyPt * 2;
    } else {
      var iw = textW * 0.48;
      img(pg, [MG.top, x, page.heightMm - MG.bottom, x + iw], assetPath(spec.image), 'bg');
      var tx = x + iw + gutter * 2;
      txt(pg, [MG.top, tx, MG.top + 40, tx + textW - iw - gutter * 2], spec.title || '', TY.sansFont, 'Bold', 18, 24, cText, 30, Justification.LEFT_ALIGN);
      txt(pg, [MG.top + 46, tx, page.heightMm - MG.bottom, tx + textW - iw - gutter * 2], paras(spec.textRange).join(CR), TY.bodyFont, 'Regular', TY.bodyPt, TY.leadingPt, cText, 0, Justification.LEFT_ALIGN).parentStory.firstLineIndent = TY.bodyPt * 2;
    }
    return '图文页（图' + side + '）';
  }

  function pat_quote(pageIdx, spec) {
    var pg = doc.pages[pageIdx], x = pageX(pageIdx);
    if (spec.image) { img(pg, [-page.bleedMm, -page.bleedMm, page.heightMm + page.bleedMm, page.widthMm + page.bleedMm], assetPath(spec.image), 'bg'); }
    txt(pg, [MG.top + 40, x, MG.top + 120, x + textW], spec.text, TY.titleFont, 'Regular', 26, 40, cText, 20, Justification.LEFT_ALIGN);
    if (spec.source) { txt(pg, [MG.top + 130, x, MG.top + 144, x + textW], spec.source, TY.sansFont, 'Regular', 9, 13, cMuted, 60, Justification.LEFT_ALIGN); }
    rect(pg, [MG.top + 158, x, MG.top + 158.8, x + 40], cAccent, 'rule');
    return '引文页';
  }

  function pat_toc(pageIdx, spec) {
    var pg = doc.pages[pageIdx], x = pageX(pageIdx);
    txt(pg, [MG.top, x, MG.top + 14, x + textW], spec.title || '目录', TY.sansFont, 'Bold', 26, 32, cAccent, 60, Justification.LEFT_ALIGN);
    var items = spec.items || [];
    var left = [], right = [];
    for (var k = 0; k < items.length; k++) {
      left.push(items[k][0]);
      right.push(String(items[k][1]));
    }
    var top = MG.top + 26, bottom = MG.top + 26 + items.length * 11 + 6;
    var f1 = txt(pg, [top, x, bottom, x + textW - 22], left.join(CR + CR), TY.bodyFont, 'Regular', 11, 30, cText, 0, Justification.LEFT_ALIGN);
    txt(pg, [top, x + textW - 22, bottom, x + textW], right.join(CR + CR), TY.bodyFont, 'Regular', 11, 30, cText, 0, Justification.RIGHT_ALIGN);
    return '目录页';
  }

  function pat_blank(pageIdx, spec) { return '留白页'; }

  // 署名：三级递减、右对齐（第一级最大最亮，第三级最小最弱）
  function pat_signature(pageIdx, spec) {
    var pg = doc.pages[pageIdx], x = pageX(pageIdx);
    var lines = spec.lines || [];
    var layout = spec.layout || D.sigLayout || [[12, 18, 26, 40], [9.5, 15, 5, 60], [8.5, 13, 4, 20]];
    var colors = [cText, cMuted, cDim];
    var top = spec.topMm || (page.heightMm - MG.bottom - (lines.length * 16 + 20));
    for (var k = 0; k < lines.length; k++) {
      var L = layout[k] || layout[layout.length - 1];
      var h = L[1] / MM * 1.2;
      var y = top + k * 15;
      var tf = txt(pg, [y, x, y + h, x + textW], lines[k], TY.sansFont, 'Regular', L[0], L[1], colors[k] || colors[colors.length - 1], L[3], Justification.RIGHT_ALIGN);
      tf.parentStory.firstLineIndent = 0;
      tf.parentStory.spaceBefore = 0;
    }
    return '署名（' + lines.length + ' 级）';
  }

  // ---------------- 逐页渲染 ----------------
  var flowFrames = [], log = [];
  for (var pi2 = 0; pi2 < cfg.pages.length; pi2++) {
    var spec = cfg.pages[pi2];
    var name = spec.pattern || 'blank';
    var desc = '';
    if (name === 'cover') { desc = pat_cover(pi2, spec); }
    else if (name === 'text') { desc = pat_text(pi2, spec, flowFrames); }
    else if (name === 'plate') { desc = pat_plate(pi2, spec); }
    else if (name === 'imageText') { desc = pat_imageText(pi2, spec); }
    else if (name === 'quote') { desc = pat_quote(pi2, spec); }
    else if (name === 'toc') { desc = pat_toc(pi2, spec); }
    else if (name === 'signature') { desc = pat_signature(pi2, spec); }
    else { desc = pat_blank(pi2, spec); }
    log.push('P' + (pi2 + 1) + ':' + name + '（' + desc + '）');
  }
  // 串文
  for (var ff = 0; ff < flowFrames.length - 1; ff++) { flowFrames[ff].nextTextFrame = flowFrames[ff + 1]; }
  report.push('页面：' + log.join(' '));
  report.push('串文：' + flowFrames.length + ' 个文本流框相连');

  // 数字与西文换西文字体
  var latin = 0;
  try {
    for (var s2 = 0; s2 < doc.stories.length; s2++) {
      var st2 = doc.stories[s2];
      if (!/[\u4e00-\u9fa5]/.test(String(st2.contents))) { continue; }
      for (var pp2 = 0; pp2 < st2.paragraphs.length; pp2++) {
        var psz = st2.paragraphs[pp2].pointSize, chs = st2.paragraphs[pp2].characters;
        for (var ci = 0; ci < chs.length; ci++) {
          if (/[0-9A-Za-z.%]/.test(String(chs[ci].contents))) {
            chs[ci].appliedFont = TY.latinFont + TAB + 'Regular';
            chs[ci].pointSize = psz - 0.5;
            latin++;
          }
        }
      }
    }
  } catch (e2) { }
  report.push('西文/数字换字体：' + latin + ' 个字符');

  // ---------------- 自查 ----------------
  function hit(a, b) { var tol = 0.3 * MM; return (Math.min(a[2], b[2]) - Math.max(a[0], b[0]) > tol) && (Math.min(a[3], b[3]) - Math.max(a[1], b[1]) > tol); }
  var HEAD = '，。、；：？！）】》」』”’…—·％‰℃〉', TAIL = '（【《「『“‘〈';
  var overlaps = [], overflows = [], kh = 0, kt = 0, lineCount = 0, counts = [];
  for (var cp = 0; cp < doc.pages.length; cp++) {
    var pg2 = doc.pages[cp], tfs = [], rects = [];
    for (var t2 = 0; t2 < pg2.textFrames.length; t2++) {
      tfs.push(pg2.textFrames[t2].geometricBounds);
      if (pg2.textFrames[t2].overflows) { overflows.push('P' + (cp + 1)); }
    }
    for (var r2 = 0; r2 < pg2.rectangles.length; r2++) {
      var rc2 = pg2.rectangles[r2];
      if (rc2.label !== 'bg' && rc2.label !== 'band') { rects.push(rc2.geometricBounds); }
    }
    for (var m2 = 0; m2 < tfs.length; m2++) {
      for (var n2 = m2 + 1; n2 < tfs.length; n2++) { if (hit(tfs[m2], tfs[n2])) { overlaps.push('P' + (cp + 1)); break; } }
      for (var q2 = 0; q2 < rects.length; q2++) { if (hit(tfs[m2], rects[q2])) { overlaps.push('P' + (cp + 1) + '↔色块'); break; } }
    }
  }
  for (var s3 = 0; s3 < doc.stories.length; s3++) {
    var stl = doc.stories[s3].lines;
    for (var L = 0; L < stl.length; L++) {
      var lt = String(stl[L].contents);
      if (lt.length < 2) { continue; }
      lineCount++;
      // 「—— 出处」这类署名行以破折号开头是中文常规用法，不算违例
      var isAttribution = (lt.charAt(0) === '—' && lt.length <= 24);
      if (!isAttribution && HEAD.indexOf(lt.substr(0, 1)) >= 0) { kh++; }
      if (TAIL.indexOf(lt.substr(lt.length - 1, 1)) >= 0) { kt++; }
      if (HEAD.indexOf(lt.substr(0, 1)) >= 0 || TAIL.indexOf(lt.substr(lt.length - 1, 1)) >= 0) {
        if (kh + kt <= 3) { report.push('  ★ 避头尾违例：行首「' + lt.substr(0, 1) + '」行尾「' + lt.substr(lt.length - 1, 1) + '」← ' + lt.substr(0, 12)); }
      }
      var cjk = lt.match(/[\u4e00-\u9fa5]/g); if (cjk && counts.length < 60) { counts.push(cjk.length); }
    }
  }
  var sc = counts.slice().sort(function (a, b) { return a - b; });
  report.push('自查·几何：重叠=' + (overlaps.length ? overlaps.join('、') : '无') + ' 溢出=' + (overflows.length ? overflows.join('、') : '无'));
  report.push('自查·避头尾：行首 ' + kh + ' / 行尾 ' + kt + '（受检 ' + lineCount + ' 行）');
  report.push('自查·行宽：中位 ' + (sc.length ? sc[Math.floor(sc.length / 2)] : '?') + ' 字（25–35 为舒适区）');

  // ---------------- 导出 ----------------
  var pp3 = app.pdfExportPreferences;
  pp3.pageRange = '全部'; pp3.useDocumentBleedWithPDF = true;
  try { pp3.pdfColorSpace = PDFColorSpace.REPURPOSE_CMYK; } catch (e3) { }
  var pdfFile = new File(cfg.outDir + '/' + cfg.outputBase + '.pdf');
  if (pdfFile.exists) { pdfFile.remove(); }
  doc.exportFile(ExportFormat.PDF_TYPE, pdfFile, false);
  report.push('PDF：' + Math.round(pdfFile.length / 1024) + 'KB（CMYK + 出血 ' + page.bleedMm + 'mm，' + doc.pages.length + ' 页）');

  var jp = app.jpegExportPreferences;
  jp.jpegQuality = JPEGOptionsQuality.MAXIMUM; jp.exportResolution = cfg.previewDpi || 300;
  jp.jpegColorSpace = JpegColorSpaceEnum.RGB; jp.antiAlias = true;
  var hiBase = new File(cfg.workDir + '/hi.jpg');
  if (hiBase.exists) { hiBase.remove(); }
  doc.exportFile(ExportFormat.JPG, hiBase, false);
  report.push('页图：' + (cfg.previewDpi || 300) + 'dpi');

  var indd = new File(cfg.outDir + '/' + cfg.outputBase + '.indd');
  doc.save(indd);
  report.push('源文件已保存');
  doc.close(SaveOptions.NO);

  if (prevActiveName !== '') {
    for (var m4 = 0; m4 < app.documents.length; m4++) {
      if (app.documents[m4].name === prevActiveName && app.documents[m4].windows.length > 0) { app.documents[m4].windows[0].bringToFront(); break; }
    }
  }
  report.push('耗时=' + Math.round((new Date().getTime() - t0) / 100) / 10 + ' 秒');
  report.join('\n');
}
