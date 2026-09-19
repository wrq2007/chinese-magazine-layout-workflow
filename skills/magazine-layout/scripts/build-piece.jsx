// 通用单篇排版（配置驱动）：读 piece.json + paragraphs.json → 建文档 → 排版 → 导出 → 自查 → 存 → 关
// 设计原则：文本只从文件读取，绝不手打进脚本（手打会丢字符——实测丢过 "&"、还被擅自改过标点）
// 单位约定：标尺 POINTS，坐标用 P(mm)，字号/行距直接写磅值
// 并行安全：只操作自己 label 的文档，收工关闭自己并恢复原置前文档
app.scriptPreferences.measurementUnit = MeasurementUnits.POINTS;
var MM = 2.8346456693;
function P(mm) { return mm * MM; }
var TAB = String.fromCharCode(9), CR = String.fromCharCode(13);
var t0 = new Date().getTime();
var report = [];

// ---------- 读配置 ----------
var cfgFile = new File('E:/杂志/序言/_build/piece.json');
if (!cfgFile.exists) { 'CONFIG_NOT_FOUND: ' + cfgFile.fsName; }
else {
  cfgFile.encoding = 'UTF-8';
  cfgFile.open('r'); var cfgText = cfgFile.read(); cfgFile.close();
  var cfg = eval('(' + cfgText + ')');

  var pgFile = new File(cfg.paragraphsJson);
  pgFile.encoding = 'UTF-8'; pgFile.open('r');
  var paragraphs = eval('(' + pgFile.read() + ')'); pgFile.close();

  var page = cfg.page, margin = cfg.margins, type = cfg.type, start = cfg.start, col = cfg.colors;
  var pageCount = page.pages;
  var textW = page.widthMm - margin.inside - margin.outside;

  var prevActiveName = '';
  try { if (app.documents.length > 0) { prevActiveName = app.activeDocument.name; } } catch (e) { }
  for (var i = app.documents.length - 1; i >= 0; i--) {
    if (app.documents[i].label === cfg.label) { app.documents[i].close(SaveOptions.NO); }
  }

  var doc = app.documents.add();
  doc.label = cfg.label;
  var dp = doc.documentPreferences;
  dp.pageWidth = P(page.widthMm); dp.pageHeight = P(page.heightMm);
  dp.facingPages = false; dp.pagesPerDocument = pageCount;
  dp.documentBleedUniformSize = true; dp.documentBleedTopOffset = P(page.bleedMm);
  for (var p = 0; p < doc.pages.length; p++) {
    var mp = doc.pages[p].marginPreferences;
    var isRight = (p % 2 === 0);
    mp.top = P(margin.top); mp.bottom = P(margin.bottom);
    mp.left = P(isRight ? margin.inside : margin.outside);
    mp.right = P(isRight ? margin.outside : margin.inside);
  }

  function getColor(name, rgb) {
    var c = doc.colors.itemByName(name);
    if (c.isValid) { return c; }
    return doc.colors.add({ name: name, model: ColorModel.PROCESS, space: ColorSpace.RGB, colorValue: rgb });
  }
  var cText = getColor('PieceText', col.text);
  var cAccent = getColor('PieceAccent', col.accent);
  var cSig2 = getColor('PieceSig2', col.sig2);
  var cSig3 = getColor('PieceSig3', col.sig3);
  var none = doc.swatches.itemByName('None');

  // ---------- 背景 ----------
  var bgNames = [];
  if (pageCount === 1) { bgNames = ['bg-page.jpg']; }
  else { for (var b = 0; b < pageCount; b++) { bgNames.push(b === 0 ? 'bg-left.jpg' : 'bg-right.jpg'); } }
  if (!cfg.skipBackground) {
    for (var bp = 0; bp < doc.pages.length; bp++) {
      var frame = doc.pages[bp].rectangles.add({
        geometricBounds: [P(-page.bleedMm), P(-page.bleedMm), P(page.heightMm + page.bleedMm), P(page.widthMm + page.bleedMm)]
      });
      frame.place(File(cfg.bgDir + bgNames[bp]));
      frame.fit(FitOptions.FILL_PROPORTIONALLY); frame.fit(FitOptions.CENTER_CONTENT);
      frame.strokeWeight = 0; frame.strokeColor = none; frame.label = 'bg';
    }
  }

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
  function sigStyle(par, s) {   // s = [size, leading, spaceBefore, tracking]
    par.justification = Justification.RIGHT_ALIGN; par.firstLineIndent = 0;
    par.pointSize = s[0]; par.leading = s[1]; par.spaceBefore = s[2]; par.tracking = s[3];
  }

  var p1 = doc.pages[0], pLast = doc.pages[doc.pages.length - 1];
  var xIn = margin.inside, xOut = margin.outside;
  var lastX = (pageCount % 2 === 0) ? xOut : xIn;

  // ---------- 标题区 ----------
  if (cfg.kicker) {
    txt(p1, [start.kickerTopMm, xIn, start.kickerTopMm + 8, xIn + textW], cfg.kicker, type.sansFont, 'Regular', type.kickerPt, type.kickerPt * 1.4, cSig2, 200, Justification.LEFT_ALIGN);
  }
  var titleText = paragraphs[cfg.titleIndex];
  txt(p1, [start.titleTopMm, xIn, start.titleTopMm + 38, xIn + textW], titleText, type.titleFont, 'Regular', type.titlePt, type.titlePt * 1.22, cText, 40, Justification.LEFT_ALIGN);
  if (start.ruleTopMm > 0) {
    var rule = p1.rectangles.add({ geometricBounds: [P(start.ruleTopMm), P(xIn), P(start.ruleTopMm + 0.6), P(xIn + 34)] });
    rule.fillColor = cAccent; rule.strokeWeight = 0; rule.strokeColor = none;
  }

  // ---------- 正文（跨页续排） ----------
  var bodyParas = [];
  for (var bi = cfg.bodyFromIndex; bi < cfg.signatureFromIndex; bi++) { bodyParas.push(paragraphs[bi]); }

  // ---------- 署名（按 signatureArrange 重组：数组项 = 源段索引列表，多索引用 · 连接） ----------
  var sigLines = [];
  if (cfg.signatureArrange) {
    for (var sa = 0; sa < cfg.signatureArrange.length; sa++) {
      var parts = [];
      for (var sb = 0; sb < cfg.signatureArrange[sa].length; sb++) { parts.push(paragraphs[cfg.signatureArrange[sa][sb]]); }
      sigLines.push(parts.join(cfg.signatureJoin || '·'));
    }
  }

  var frames = [];
  for (var fp = 0; fp < doc.pages.length; fp++) {
    var px = (fp % 2 === 0) ? xIn : xOut;
    var top = (fp === 0) ? start.bodyTopMm : margin.top;
    var f = doc.pages[fp].textFrames.add({ geometricBounds: [P(top), P(px), P(page.heightMm - margin.bottom), P(px + textW)] });
    f.label = 'body'; frames.push(f);
  }
  for (var fx = 0; fx < frames.length - 1; fx++) { frames[fx].nextTextFrame = frames[fx + 1]; }

  frames[0].contents = bodyParas.join(CR) + (sigLines.length ? CR + sigLines.join(CR) : '');
  var bs = frames[0].parentStory;
  bs.appliedFont = type.bodyFont + TAB + 'Regular';
  bs.pointSize = type.bodyPt; bs.leading = type.leadingPt; bs.fillColor = cText;
  bs.firstLineIndent = type.bodyPt * 2; bs.spaceBefore = 0; bs.hyphenation = false;

  var paraCount = bs.paragraphs.length;
  var sigStart = paraCount - sigLines.length;
  for (var sq = 0; sq < sigLines.length; sq++) {
    var style = cfg.sigLayout[sq] || cfg.sigLayout[cfg.sigLayout.length - 1];
    var color = (sq === 0) ? cText : ((sq === 1) ? cSig2 : cSig3);
    try { sigStyle(bs.paragraphs[sigStart + sq], style); bs.paragraphs[sigStart + sq].fillColor = color; } catch (e1) { }
  }

  // 数字与西文换西文字体（& 不换：避免被自动中西文间距撑开）
  var latinCount = 0;
  try {
    for (var pi2 = 0; pi2 < bs.paragraphs.length; pi2++) {
      var ps2 = bs.paragraphs[pi2].pointSize;
      var chars = bs.paragraphs[pi2].characters;
      for (var ci2 = 0; ci2 < chars.length; ci2++) {
        if (/[0-9A-Za-z.%]/.test(String(chars[ci2].contents))) {
          chars[ci2].appliedFont = type.latinFont + TAB + 'Regular';
          chars[ci2].pointSize = ps2 - 0.5;
          latinCount++;
        }
      }
    }
  } catch (e2) { }

  report.push('排版：' + pageCount + '页 版心' + textW + 'mm 正文段=' + bodyParas.length + ' 署名=' + sigLines.length +
    ' 西文字符=' + latinCount + ' 溢出=' + frames[frames.length - 1].overflows);

  // ---------- 自查 ----------
  function hit(a, b) { var tol = 0.3 * MM; return (Math.min(a[2], b[2]) - Math.max(a[0], b[0]) > tol) && (Math.min(a[3], b[3]) - Math.max(a[1], b[1]) > tol); }
  var HEAD = '，。、；：？！）】》」』”’…—·％‰℃〉', TAIL = '（【《「『“‘〈';
  var overlaps = [], overflows = [], kh = [], kt = [];
  for (var cp = 0; cp < doc.pages.length; cp++) {
    var page2 = doc.pages[cp], tfs = [], rects = [];
    for (var t2 = 0; t2 < page2.textFrames.length; t2++) {
      tfs.push({ b: page2.textFrames[t2].geometricBounds, txt: String(page2.textFrames[t2].contents).substr(0, 10).replace(/\r|\n/g, ' ') });
      if (page2.textFrames[t2].overflows) { overflows.push('P' + (cp + 1)); }
    }
    for (var r2 = 0; r2 < page2.rectangles.length; r2++) { rects.push({ b: page2.rectangles[r2].geometricBounds, label: page2.rectangles[r2].label }); }
    for (var m2 = 0; m2 < tfs.length; m2++) {
      for (var n2 = m2 + 1; n2 < tfs.length; n2++) { if (hit(tfs[m2].b, tfs[n2].b)) { overlaps.push('P' + (cp + 1) + '「' + tfs[m2].txt + '」/「' + tfs[n2].txt + '」'); } }
      for (var q2 = 0; q2 < rects.length; q2++) { if (hit(tfs[m2].b, rects[q2].b) && rects[q2].label !== 'bg') { overlaps.push('P' + (cp + 1) + '「' + tfs[m2].txt + '」↔色块'); } }
    }
  }
  var lines = bs.lines, counts = [];
  for (var L2 = 0; L2 < lines.length; L2++) {
    var lt2 = String(lines[L2].contents);
    if (lt2.length < 2) { continue; }
    if (HEAD.indexOf(lt2.substr(0, 1)) >= 0) { kh.push('行' + (L2 + 1)); }
    if (TAIL.indexOf(lt2.substr(lt2.length - 1, 1)) >= 0) { kt.push('行' + (L2 + 1)); }
    var cjk2 = lt2.match(/[\u4e00-\u9fa5]/g); if (cjk2 && counts.length < 40) { counts.push(cjk2.length); }
  }
  var sc = counts.slice().sort(function (a, b) { return a - b; });
  report.push('自查·几何：重叠=' + (overlaps.length ? overlaps.join('；') : '无') + ' 溢出=' + (overflows.length ? overflows.join('；') : '无'));
  report.push('自查·避头尾：行首' + (kh.length || '无') + ' 行尾' + (kt.length || '无') + ' 受检行=' + lines.length);
  report.push('自查·行宽：中位' + (sc.length ? sc[Math.floor(sc.length / 2)] : '?') + '字（' + (sc.length ? sc[0] + '–' + sc[sc.length - 1] : '?') + '）');

  // ---------- 导出 ----------
  var pp = app.pdfExportPreferences;
  pp.pageRange = '全部'; pp.useDocumentBleedWithPDF = true;
  try { pp.pdfColorSpace = PDFColorSpace.REPURPOSE_CMYK; } catch (e3) { }
  var pdfFile = new File(cfg.outDir + '/' + cfg.outputBase + '.pdf');
  if (pdfFile.exists) { pdfFile.remove(); }
  doc.exportFile(ExportFormat.PDF_TYPE, pdfFile, false);
  report.push('PDF：' + Math.round(pdfFile.length / 1024) + 'KB（CMYK + 出血 ' + page.bleedMm + 'mm）');

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
    for (var m3 = 0; m3 < app.documents.length; m3++) {
      if (app.documents[m3].name === prevActiveName && app.documents[m3].windows.length > 0) { app.documents[m3].windows[0].bringToFront(); break; }
    }
  }
  report.push('耗时=' + Math.round((new Date().getTime() - t0) / 100) / 10 + ' 秒');
  report.join('\n');
}
