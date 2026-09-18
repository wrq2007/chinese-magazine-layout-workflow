// ============================================================================
// lib-flow-measure.jsx —— "先量后放"排版库（可被任何 InDesign 脚本 #include）
//
// 解决的问题：InDesign 的文本框是绝对定位的，不会互相避让。
//   用固定高度写死版面时，只要文字量少于预期，就会出现"两块文字框大面积重叠"
//   却没有任何报错的情况（导出后字压字）。2026-09《通透》六页稿上真踩过。
//
// 做法：建框 → 让 InDesign 自己量出真实高度 → 关掉自动尺寸 → 按测得高度重设边界
//       → 下一个块接在这个底边之下。这样"逐块往下排"在数学上不可能重叠。
//
// 用法：
//   #include "lib-flow-measure.jsx"
//   FM.init(185, 260, {top:18, bottom:22, inside:20, outside:16}, 3);
//   var doc = FM.newDoc('MyBuild', 6);
//   var y = FM.flow(doc.pages[0], 20, 50, 110, '正文……', {font: FM.F_BODY, size: 11, leading: 19.5, color: FM.K});
//   var b = FM.pic(doc.pages[0], 'E:/x/a.jpg', 20, y, 66);      // 按宽度放图，返回底边 y
//   FM.latinify(doc);                                          // 数字/西文换 Times（& 不动）
//   FM.report(doc).join('\n');
// ============================================================================

var FM = {};

FM.MM = 2.8346456693;
FM.TAB = String.fromCharCode(9);
FM.CR = String.fromCharCode(13);

FM.mm = function (v) { return v * FM.MM; };
FM.init = function (pageW, pageH, mg, bleed) {
  app.scriptPreferences.measurementUnit = MeasurementUnits.POINTS;  // 一个脚本只用一种单位
  FM.W = pageW; FM.H = pageH; FM.MG = mg; FM.BLEED = bleed;
  FM.TW = pageW - mg.inside - mg.outside;
  FM.LOG = [];
};
FM.log = function (s) { FM.LOG.push(s); };

// 字体：给出"族 + 字重"，任一写法无效时依次回退（宋体的字重名在不同版本里是 Regular 或 常规）
FM.font = function (fam, styles) {
  var tries = (styles || []).concat(['Regular', '常规']);
  for (var i = 0; i < tries.length; i++) {
    try { if (app.fonts.itemByName(fam + FM.TAB + tries[i]).isValid) { return fam + FM.TAB + tries[i]; } } catch (e) { }
  }
  return fam;
};

FM.color = function (doc, name, space, val) {
  var c = doc.colors.itemByName(name);
  if (c.isValid) { return c; }
  return doc.colors.add({ name: name, model: ColorModel.PROCESS, space: space, colorValue: val });
};

// 新建文档：标尺单位在 init() 里已设为磅，页面尺寸因此要乘 2.8346
FM.newDoc = function (label, pages, facing) {
  for (var i = app.documents.length - 1; i >= 0; i--) {
    if (app.documents[i].label === label) { app.documents[i].close(SaveOptions.NO); }
  }
  var doc = app.documents.add();
  doc.label = label;
  var dp = doc.documentPreferences;
  dp.pageWidth = FM.mm(FM.W); dp.pageHeight = FM.mm(FM.H);
  dp.facingPages = !!facing;
  dp.pagesPerDocument = pages;
  dp.documentBleedUniformSize = true;
  dp.documentBleedTopOffset = FM.mm(FM.BLEED);
  for (var p = 0; p < doc.pages.length; p++) {
    var mp = doc.pages[p].marginPreferences;
    var isRight = (p % 2 === 0);
    mp.top = FM.mm(FM.MG.top); mp.bottom = FM.mm(FM.MG.bottom);
    mp.left = FM.mm(isRight ? FM.MG.inside : FM.MG.outside);
    mp.right = FM.mm(isRight ? FM.MG.outside : FM.MG.inside);
  }
  return doc;
};
FM.x0 = function (pageIdx) { return (pageIdx % 2 === 0) ? FM.MG.inside : FM.MG.outside; };

// 色块 / 细线
FM.rect = function (pg, y1, x1, y2, x2, color, none) {
  var r = pg.rectangles.add({ geometricBounds: [FM.mm(y1), FM.mm(x1), FM.mm(y2), FM.mm(x2)] });
  r.fillColor = color; r.strokeWeight = 0; r.strokeColor = none; r.label = 'rule';
  return r;
};
FM.hrule = function (pg, x, y, wMm, wPt, color, none) {
  return FM.rect(pg, y, x, y + wPt / FM.MM, x + wMm, color, none);
};
FM.vrule = function (pg, x, y, hMm, wPt, color, none) {
  return FM.rect(pg, y, x, y + hMm, x + wPt / FM.MM, color, none);
};

// 统一的 story 样式设置（内部用）
FM._set = function (f, text, o) {
  f.textFramePreferences.insetSpacing = [0, 0, 0, 0];
  var st = f.parentStory;
  st.appliedFont = o.font; st.pointSize = o.size; st.leading = o.leading;
  st.fillColor = o.color; st.tracking = o.tracking || 0;
  st.hyphenation = false; st.justification = o.just || Justification.LEFT_ALIGN;
  st.firstLineIndent = o.indent || 0;
  st.spaceBefore = 0; st.spaceAfter = 0;
  f.contents = text;
  if (o.em) {   // 原文里的强调（**…**）：换强调字体显示，不改动任何字符
    try {
      var whole = String(f.parentStory.contents);
      var idx = whole.indexOf(o.em);
      if (idx >= 0) { f.parentStory.characters.itemByRange(idx, idx + o.em.length - 1).appliedFont = o.emFont; }
    } catch (eE) { }
  }
  return f.parentStory;
};

// ★ 核心：先建一个超高框 → autoSizing 量真实高度 → 关掉 → 按高度重设边界
// 注意：autoSizing 在本机是"绕中心缩放"的，autoSizingReferencePoint 不生效，
//       所以只能拿它的高度，坐标必须自己重设。
// o = {font, size, leading, color, tracking, just, indent, em}
// em: 传入原文里的强调片段（**…**），会用强调字体（黑体）显示，不改动任何字符
FM.flow = function (pg, x, y, w, text, o) {
  var f = pg.textFrames.add({ geometricBounds: [FM.mm(y), FM.mm(x), FM.mm(y + 900), FM.mm(x + w)] });
  f.textFramePreferences.insetSpacing = [0, 0, 0, 0];
  var st = f.parentStory;
  st.appliedFont = o.font; st.pointSize = o.size; st.leading = o.leading;
  st.fillColor = o.color; st.tracking = o.tracking || 0;
  st.hyphenation = false; st.justification = o.just || Justification.LEFT_ALIGN;
  st.firstLineIndent = o.indent || 0;
  st.spaceBefore = 0; st.spaceAfter = 0;
  f.contents = text;
  // 测高：用"行数 × 行距"，不用 autoSizing。
  // 因为本机实测 autoSizing 有刷新时序问题——只设 autoSizingType 读到原值（900mm 不收拢），
  // 再补设 autoSizingReferencePoint 又可能读到 1.1mm 的错值，且参照点设置不生效（绕中心缩放）。
  // 行数 × 行距是确定性的，且与"逐块往下排"的模型完全一致（spaceBefore/After 均为 0）。
  var nLines = 0;
  try {
    var lns = f.parentStory.lines;
    for (var li = 0; li < lns.length; li++) { nLines++; }
  } catch (eL) { FM.log('行数读取失败：' + eL); }
  var hPt = nLines * o.leading;
  if (nLines < 1) {                       // 兜底：内容为空或读不到行时，给一行的高度
    hPt = o.leading;
  }
  f.geometricBounds = [FM.mm(y), FM.mm(x), FM.mm(y) + hPt, FM.mm(x + w)];
  f.label = 'txt';
  f.textFramePreferences.autoSizingType = AutoSizingTypeEnum.OFF;
  if (f.overflows) { FM.log('警告：' + nLines + ' 行仍溢出该高度，检查 leading 是否与段落一致'); }
  if (o.em) {
    try {
      var whole = String(f.parentStory.contents);
      var idx = whole.indexOf(o.em);
      if (idx >= 0) { f.parentStory.characters.itemByRange(idx, idx + o.em.length - 1).appliedFont = o.emFont; }
    } catch (eC) { }
  }
  return y + hPt / FM.MM;                      // 返回底边 y（mm）
};

// 放图：**先算尺寸再建框**，不依赖任何 fit 的副作用，返回图的真实底边 y。
// 必须传入源图像素宽高——这样高度是算出来的确定值。
// 走过的弯路（别再试）：
//   ① 建个临时高度的框再读 frame.geometricBounds → 读到的是临时高度，不是图高；
//   ② 用 fit(PROPORTIONALLY) → 那是"把图装进框"，图会缩到框里，宽度不对；
//   ③ 用 FRAME_TO_CONTENT → 未缩放的图有 300mm 级的原始尺寸，框一拉就顶到粘贴板外报错。
FM.pic = function (pg, filePath, x, y, wMm, pxW, pxH, none, note) {
  var hMm = wMm * pxH / pxW;
  var f = pg.rectangles.add({ geometricBounds: [FM.mm(y), FM.mm(x), FM.mm(y + hMm), FM.mm(x + wMm)] });
  f.place(new File(filePath));
  f.fit(FitOptions.PROPORTIONALLY);      // 框的宽高比已等于原图，装进去正好铺满、不裁切
  f.fit(FitOptions.CENTER_CONTENT);
  f.strokeWeight = 0; f.strokeColor = none; f.label = note || 'img';
  return y + hMm;
};
// 按"有效 dpi 不低于 N"倒推这张图最多能放多宽（mm）
FM.maxW = function (pxW, minDpi) { return pxW / (minDpi || 350) * 25.4; };
FM.dpiOf = function (pxW, wMm) { return Math.round(pxW / (wMm / 25.4)); };

// 多栏串文：正文按 n 栏往下灌，返回底边 y。
// 步骤：① 临时框数总行数 → ② 按"每栏均分"猜一个栏高 → ③ 真建链式框，查末栏是否溢出，
//       溢出就加一行高度重建（最多 10 次）。
// 为什么要"建了再查"：栏内可能有行距不同的段落（如引文 26pt、正文 19.5pt），
// 单纯按 总行数÷栏数 会把高度算短，末栏一定溢出。踩过。
// o.after(story)：可选回调，用来在建框后给个别段落单独套样式（引文、强调等）。
// 注意：分栏适合整块文字；短到每栏不足 3 行的块直接单栏，别分。
FM.cols = function (pg, x, y, wMm, n, gutterMm, text, o) {
  var cw = (wMm - gutterMm * (n - 1)) / n;
  var probe = pg.textFrames.add({ geometricBounds: [FM.mm(20), FM.mm(x), FM.mm(240), FM.mm(x + cw)] });
  var pst = FM._set(probe, text, o);
  if (o.after) { o.after(pst); }
  var L = pst.lines.length;
  probe.remove();

  var baseLines = Math.ceil(L / n);
  var frames = null, hPt = 0;
  for (var attempt = 0; attempt < 10; attempt++) {
    hPt = (baseLines + attempt) * o.leading;
    frames = [];
    for (var i = 0; i < n; i++) {
      var fx = x + i * (cw + gutterMm);
      frames.push(pg.textFrames.add({ geometricBounds: [FM.mm(y), FM.mm(fx), FM.mm(y) + hPt, FM.mm(fx + cw)] }));
    }
    for (var k = 0; k < n - 1; k++) { frames[k].nextTextFrame = frames[k + 1]; }
    var st = FM._set(frames[0], text, o);
    if (o.after) { o.after(st); }
    var overflowed = false;
    for (var j = 0; j < n; j++) { if (frames[j].overflows) { overflowed = true; } }
    if (!overflowed) { break; }
    for (var d = 0; d < frames.length; d++) { frames[d].remove(); }
    frames = null;
  }
  if (frames === null) {
    FM.log('  警告：' + n + ' 栏反复装不下（共 ' + L + ' 行），已放弃分栏');
    return y;
  }
  frames[0].label = 'cols';
  return y + hPt / FM.MM;
};

// 数字/西文换西文字体（比中文小半磅）。& 不按西文处理——否则会被中西文间距撑开、字重也不对
FM.latinify = function (doc, latinFont, re) {
  var rx = re || /[0-9A-Za-z.%]/;
  var n = 0;
  for (var s = 0; s < doc.stories.length; s++) {
    var st = doc.stories[s];
    if (!/[0-9A-Za-z]/.test(String(st.contents))) { continue; }
    var paras = st.paragraphs;
    for (var i = 0; i < paras.length; i++) {
      var ps = paras[i].pointSize, chs = paras[i].characters;
      for (var j = 0; j < chs.length; j++) {
        var c = String(chs[j].contents);
        if (rx.test(c)) { try { chs[j].appliedFont = latinFont; chs[j].pointSize = ps - 0.5; n++; } catch (e) { } }
      }
    }
  }
  return n;
};

// 自查：重叠（含线/色块/图，不按类型排除）/ 溢出 / 避头尾 / 行宽 / 每页内容底端
FM.report = function (doc, headChars, tailChars) {
  var HEAD = headChars || '，。、；：？！）】》」』”’…—·％‰℃〉';
  var TAIL = tailChars || '（【《「『“‘〈';
  var tol = 0.3 * FM.MM;
  function hit(a, b) {
    return (Math.min(a[2], b[2]) - Math.max(a[0], b[0]) > tol) && (Math.min(a[3], b[3]) - Math.max(a[1], b[1]) > tol);
  }
  var overlaps = [], overflows = [], kh = 0, kt = 0, counts = [];
  // 重叠要连坐标一起报：只写"文本↔图/线"定位不了是哪两块，等于没报
  function where(bb) {
    return 'y' + Math.round(bb[0] / FM.MM) + '–' + Math.round(bb[2] / FM.MM) +
           ' x' + Math.round(bb[1] / FM.MM) + '–' + Math.round(bb[3] / FM.MM);
  }
  for (var cp = 0; cp < doc.pages.length; cp++) {
    var pg = doc.pages[cp], tfs = [], rcs = [];
    for (var t = 0; t < pg.textFrames.length; t++) {
      tfs.push(pg.textFrames[t].geometricBounds);
      if (pg.textFrames[t].overflows) { overflows.push('P' + (cp + 1)); }
    }
    for (var r = 0; r < pg.rectangles.length; r++) { rcs.push(pg.rectangles[r].geometricBounds); }
    for (var m = 0; m < tfs.length; m++) {
      for (var n = m + 1; n < tfs.length; n++) {
        if (hit(tfs[m], tfs[n])) { overlaps.push('P' + (cp + 1) + ' 文本↔文本 ' + where(tfs[m]) + ' / ' + where(tfs[n])); }
      }
      for (var q = 0; q < rcs.length; q++) {
        if (hit(tfs[m], rcs[q])) { overlaps.push('P' + (cp + 1) + ' 文本↔图/线 ' + where(tfs[m]) + ' / ' + where(rcs[q])); }
      }
    }
    var maxY = 0;
    for (var t2 = 0; t2 < pg.textFrames.length; t2++) { maxY = Math.max(maxY, pg.textFrames[t2].geometricBounds[2] / FM.MM); }
    for (var r2 = 0; r2 < pg.rectangles.length; r2++) { maxY = Math.max(maxY, pg.rectangles[r2].geometricBounds[2] / FM.MM); }
    FM.log('P' + (cp + 1) + ' 内容底端 y=' + Math.round(maxY * 10) / 10 + 'mm（版心下沿 ' + (FM.H - FM.MG.bottom) + 'mm）');
  }
  for (var s = 0; s < doc.stories.length; s++) {
    var stl = doc.stories[s].lines;
    for (var L = 0; L < stl.length; L++) {
      var lt = String(stl[L].contents);
      if (lt.length < 2) { continue; }
      if (HEAD.indexOf(lt.substr(0, 1)) >= 0) { kh++; }
      if (TAIL.indexOf(lt.substr(lt.length - 1, 1)) >= 0) { kt++; }
      var cjk = lt.match(/[\u4e00-\u9fa5]/g);
      if (cjk) { counts.push(cjk.length); }
    }
  }
  var sc = counts.slice().sort(function (a, b) { return a - b; });
  FM.log('几何：重叠=' + (overlaps.length ? overlaps.join('、') : '无') + '｜溢出=' + (overflows.length ? overflows.join('、') : '无'));
  FM.log('避头尾：行首 ' + kh + ' / 行尾 ' + kt);
  FM.log('行宽（中文字数/行）：中位 ' + (sc.length ? sc[Math.floor(sc.length / 2)] : '?') +
         '，区间 ' + (sc.length ? sc[0] + '–' + sc[sc.length - 1] : '?'));
  return FM.LOG;
};

// 并行安全：开工记下置前文档名，收工恢复（Document 没有 bringToFront，要用 windows[0]）
FM.prevActive = function () {
  var n = '';
  try { if (app.documents.length > 0) { n = app.activeDocument.name; } } catch (e) { }
  return n;
};
FM.restore = function (name) {
  if (!name) { return; }
  for (var z = 0; z < app.documents.length; z++) {
    if (app.documents[z].name === name && app.documents[z].windows.length > 0) {
      app.documents[z].windows[0].bringToFront(); return;
    }
  }
};
