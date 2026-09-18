// 版面几何检查：逐页找出「文本框互相重叠」「文本压在图片/色块上」
// 用法：在 InDesign 中执行（或通过 MCP 的 execute_indesign_code 传入本文件内容）。
// 说明：InDesign 的文本框是绝对定位的，互相重叠不会给任何提示——必须程序化检查。
// 有意的叠压（封面文字压在满版图上）属于正常，需人工判断；本脚本只负责列出候选。

app.scriptPreferences.measurementUnit = MeasurementUnits.POINTS;
var MM = 2.8346456693;

var doc = null;
for (var i = 0; i < app.documents.length; i++) {
  if (app.documents[i].label === 'MagazineSkeleton') { doc = app.documents[i]; }
}
if (doc === null) { doc = app.activeDocument; }

var out = [];
function overlap(a, b) {
  var tol = 0.3 * MM;   // 0.3mm 容差，避免相邻框被判为重叠
  var top = Math.max(a[0], b[0]), left = Math.max(a[1], b[1]);
  var bottom = Math.min(a[2], b[2]), right = Math.min(a[3], b[3]);
  return (bottom - top > tol) && (right - left > tol);
}

var total = 0;
for (var p = 0; p < doc.pages.length; p++) {
  var page = doc.pages[p];
  var tfs = [], rects = [];
  for (var t = 0; t < page.textFrames.length; t++) {
    var tf = page.textFrames[t];
    tfs.push({ b: tf.geometricBounds, txt: String(tf.contents).substr(0, 10).replace(/\r|\n/g, ' ') });
  }
  for (var r = 0; r < page.rectangles.length; r++) {
    var rc = page.rectangles[r];
    rects.push({ b: rc.geometricBounds, img: rc.graphics.length > 0 });
  }
  var issues = [];
  for (var m = 0; m < tfs.length; m++) {
    for (var n = m + 1; n < tfs.length; n++) {
      if (overlap(tfs[m].b, tfs[n].b)) { issues.push('文本↔文本 "' + tfs[m].txt + '" / "' + tfs[n].txt + '"'); }
    }
    for (var q = 0; q < rects.length; q++) {
      if (overlap(tfs[m].b, rects[q].b)) { issues.push('文本↔' + (rects[q].img ? '图片' : '色块') + ' "' + tfs[m].txt + '"'); }
    }
  }
  total += issues.length;
  out.push('第' + (p + 1) + '页: ' + (issues.length ? issues.join(' | ') : '无重叠'));
}
out.push('合计可疑叠压 ' + total + ' 处（文本↔文本 一定是问题；文本↔图片 可能是有意设计，需判断）');
out.join('\n');
