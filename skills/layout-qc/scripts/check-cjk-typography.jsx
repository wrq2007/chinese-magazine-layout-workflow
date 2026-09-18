// 中文排印规范检查（在 InDesign 里执行）
// 检查项：避头尾（行首/行尾禁则）、引号成对、破折号与省略号用法、半角标点混用、
//         首行缩进一致性、中西文字体是否分离、每行字数与行距
// 用法：execute_indesign_code 传入本文件内容；默认检查 label 为 MagazineSkeleton / ForewordBuild 的文档，
//       都没有时退回当前置前文档（并在报告里写明检查对象，避免并行时误判别人的稿子）。

app.scriptPreferences.measurementUnit = MeasurementUnits.POINTS;
var MM = 2.8346456693;
var out = [];

var doc = null, byLabel = '';
var wanted = ['ForewordBuild', 'MagazineSkeleton'];
for (var w = 0; w < wanted.length; w++) {
  for (var i = 0; i < app.documents.length; i++) {
    if (app.documents[i].label === wanted[w]) { doc = app.documents[i]; byLabel = wanted[w]; break; }
  }
  if (doc !== null) { break; }
}
if (doc === null) { doc = app.activeDocument; byLabel = '(置前文档，未按 label 命中)'; }

var LINE_HEAD_FORBIDDEN = '，。、；：？！）】》」』”’…—·％‰℃〉';
var LINE_END_FORBIDDEN = '（【《「『“‘〈';
function keysOf(obj) {   // ExtendScript 是 ES3，没有 Object.keys
  var ks = [];
  for (var kk in obj) { if (obj.hasOwnProperty(kk)) { ks.push(kk); } }
  return ks;
}

out.push('检查对象：' + doc.name + '（' + byLabel + '）');
out.push('');

var kinsokuHead = [], kinsokuEnd = [];
var cjkFonts = {}, latinFonts = {};
var lineCount = 0, indentSet = {}, sizeSet = {}, leadingSet = {}, indentOdd = {};
var lineCharCounts = [];

for (var s = 0; s < doc.stories.length; s++) {
  var story = doc.stories[s];
  var text = String(story.contents);
  if (/[\u4e00-\u9fa5]/.test(text) === false) { continue; }   // 只看含中文的故事

  // 避头尾：逐行检查首尾字符
  var lines = story.lines;
  for (var L = 0; L < lines.length; L++) {
    var lt = String(lines[L].contents);
    if (lt.length < 2) { continue; }
    lineCount++;
    var head = lt.substr(0, 1), tail = lt.substr(lt.length - 1, 1);
    if (LINE_HEAD_FORBIDDEN.indexOf(head) >= 0) { kinsokuHead.push('行' + (L + 1) + ' 首="' + head + '"'); }
    if (LINE_END_FORBIDDEN.indexOf(tail) >= 0) { kinsokuEnd.push('行' + (L + 1) + ' 尾="' + tail + '"'); }
    var cjk = lt.match(/[\u4e00-\u9fa5]/g);
    if (cjk && lineCharCounts.length < 40) { lineCharCounts.push(cjk.length); }
  }

  // 段落属性一致性 + 中西文字体统计
  var paras = story.paragraphs;
  for (var p = 0; p < paras.length; p++) {
    var paraText = String(paras[p].contents);
    if (paraText.replace(/\s/g, '').length === 0) { continue; }
    indentSet[paras[p].firstLineIndent] = true;
    if (paras[p].firstLineIndent === 0) {
      var head = paraText.substr(0, 10).replace(/[\r\n]/g, '');
      indentOdd[head] = true;
    }
    sizeSet[paras[p].pointSize] = true;
    leadingSet[paras[p].leading] = true;
  }
  var chars = story.characters;
  for (var c = 0; c < chars.length; c++) {
    var chTxt = String(chars[c].contents);
    if (chTxt.length !== 1) { continue; }
    var fname = String(chars[c].appliedFont.name);
    if (/[\u4e00-\u9fa5]/.test(chTxt)) { cjkFonts[fname] = (cjkFonts[fname] || 0) + 1; }
    else if (/[0-9A-Za-z]/.test(chTxt)) { latinFonts[fname] = (latinFonts[fname] || 0) + 1; }
  }

  // 标点用法
  var quoteOpen = (text.match(/“/g) || []).length, quoteClose = (text.match(/”/g) || []).length;
  if (quoteOpen !== quoteClose) { out.push('★ 引号不成对：“ ' + quoteOpen + ' 个 / ” ' + quoteClose + ' 个'); }
  var singleEm = (text.match(/(?<!—)—(?!—)/g) || []).length;
  if (singleEm > 0) { out.push('★ 破折号疑似单破折号 ' + singleEm + ' 处（中文应为 ——）'); }
  var dots = (text.match(/\.\.\./g) || []).length;
  if (dots > 0) { out.push('★ 省略号疑似半角 ' + dots + ' 处（中文应为 ……）'); }
  var halfPunct = text.match(/[\u4e00-\u9fa5][,;:!?]/g);
  if (halfPunct) { out.push('★ 半角标点混用 ' + halfPunct.length + ' 处，如：' + halfPunct.slice(0, 3).join(' / ')); }
}

out.push('=== 避头尾 ===');
out.push('  行首禁则违例：' + (kinsokuHead.length ? '★ ' + kinsokuHead.length + ' 处（' + kinsokuHead.slice(0, 4).join('；') + '）' : '无'));
out.push('  行尾禁则违例：' + (kinsokuEnd.length ? '★ ' + kinsokuEnd.length + ' 处（' + kinsokuEnd.slice(0, 4).join('；') + '）' : '无'));
out.push('  受检行数：' + lineCount);
out.push('');
out.push('=== 中西文字体是否分离 ===');
var cjkList = [], latinList = [];
for (var k in cjkFonts) { cjkList.push(k + '×' + cjkFonts[k]); }
for (var k2 in latinFonts) { latinList.push(k2 + '×' + latinFonts[k2]); }
out.push('  中文用字：' + cjkList.join('、'));
out.push('  西文/数字：' + (latinList.length ? latinList.join('、') : '（未检出——数字可能仍用中文字体的拉丁字形）'));
out.push('');
out.push('=== 段落属性一致性 ===');
out.push('  首行缩进取值：' + keysOf(indentSet).join(' / ') + ' pt');
if (keysOf(indentOdd).length > 0) {
  out.push('  无缩进的段落（署名／图注／引文等属正常，正文段落出现才是问题）：');
  var oddKeys = keysOf(indentOdd);
  for (var oi = 0; oi < Math.min(oddKeys.length, 5); oi++) { out.push('    · 「' + oddKeys[oi] + '…」'); }
}
out.push('  字号取值：' + keysOf(sizeSet).join(' / ') + ' pt');
out.push('  行距取值：' + keysOf(leadingSet).join(' / ') + ' pt');
out.push('');
out.push('=== 每行字数（前若干行，中文计） ===');
if (lineCharCounts.length > 0) {
  var sorted = lineCharCounts.slice().sort(function (a, b) { return a - b; });
  out.push('  样本 ' + sorted.length + ' 行：最少 ' + sorted[0] + ' / 中位 ' + sorted[Math.floor(sorted.length / 2)] + ' / 最多 ' + sorted[sorted.length - 1] + ' 字');
  out.push('  舒适区参考：25–35 字/行');
}
out.join('\n');
