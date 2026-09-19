# PDF 印前客观量测：页面盒（含出血/成品框）、内嵌字体、图像有效 DPI
# 只读，不改文件。
# 用法：python check-pdf-print.py <pdf> [--w 185] [--h 260] [--bleed 3] [--no-margin]
#   开本与出血可传参，所以同一支脚本也能量 A3 单页图、海报等非刊物件。
#   ⚠️ 边距判定线写死的是刊物版心（上18/下22/内20/外16）；量非刊物件时加 --no-margin，
#      否则会把"不是刊物版心"误报成不合格。
import sys, io, fitz
from PIL import Image

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

PT2MM = 25.4 / 72.0

_args = sys.argv[2:]
def _opt(name, default):
    if name in _args:
        try:
            return float(_args[_args.index(name) + 1])
        except Exception:
            pass
    return default
EXP_W = _opt('--w', 185.0)
EXP_H = _opt('--h', 260.0)
BLEED_MM = _opt('--bleed', 3.0)
NO_MARGIN = '--no-margin' in _args

def mm(v):
    return round(v * PT2MM, 2)

path = sys.argv[1]
doc = fitz.open(path)
print('=== 文件 ===')
print(path)
print('页数:', doc.page_count)

bad = []
for i, page in enumerate(doc):
    mb = page.mediabox
    tb = page.trimbox
    bb = page.bleedbox
    w, h = mm(mb.width), mm(mb.height)
    tw, th = mm(tb.width), mm(tb.height)
    bl = mm(tb.x0 - mb.x0); br = mm(mb.x1 - tb.x1)
    bt = mm(tb.y0 - mb.y0); bo = mm(mb.y1 - tb.y1)
    print('\n--- 第 %d 页 ---' % (i + 1))
    print('  MediaBox : %.2f × %.2f mm' % (w, h))
    print('  TrimBox  : %.2f × %.2f mm  (成品尺寸)' % (tw, th))
    print('  出血      : 左%.2f 右%.2f 上%.2f 下%.2f mm' % (bl, br, bt, bo))
    if abs(tw - EXP_W) > 0.3 or abs(th - EXP_H) > 0.3:
        bad.append('P%d 成品框不是 %g×%g' % (i + 1, EXP_W, EXP_H))
    if BLEED_MM > 0:
        for name, v in (('左', bl), ('右', br), ('上', bt), ('下', bo)):
            if abs(v - BLEED_MM) > 0.3:
                bad.append('P%d %s出血 %.2fmm ≠ %.2gmm' % (i + 1, name, v, BLEED_MM))

print('\n=== 内嵌字体 ===')
allfonts = {}
for i, page in enumerate(doc):
    for f in page.get_fonts(full=True):
        xref, ext, ftype, basefont, name, encoding = f[:6]
        key = (basefont, ext if ext != 'n/a' else 'builtin')
        allfonts.setdefault(key, set()).add(i + 1)
for (basefont, ext), pages in sorted(allfonts.items()):
    print('  %-38s 嵌入方式=%-9s 页=%s' % (basefont, ext, sorted(pages)))

print('\n=== 图像有效分辨率 ===')
for i, page in enumerate(doc):
    infos = page.get_image_info(xrefs=True)
    if not infos:
        continue
    for info in infos:
        x0, y0, x1, y1 = info['bbox']
        wmm = mm(x1 - x0); hmm = mm(y1 - y0)
        sw, sh = info['width'], info['height']
        if wmm <= 0:
            continue
        dpi_x = sw / (wmm / 25.4)
        dpi_y = sh / (hmm / 25.4)
        flag = '' if dpi_x >= 300 else '   <== 低于 300dpi'
        print('  P%d %5.1f×%5.1fmm  像素%5d×%-5d  %.0f×%.0fdpi%s'
              % (i + 1, wmm, hmm, sw, sh, dpi_x, dpi_y, flag))
        if dpi_x < 300 and (dpi_x < 290):
            bad.append('P%d 图像仅 %.0fdpi' % (i + 1, dpi_x))

print('\n=== 判定 ===')
if bad:
    for b in bad:
        print('  [不合格]', b)
else:
    print('  [合格] 成品框 185×260mm、四边出血 3mm、图像分辨率 ≥300dpi')

# ---- 实际边距（墨迹包围盒，相对成品框） ----
print('\n=== 实际边距（墨迹包围盒，相对成品框） ===')
MIN = {'上': 18.0, '下': 22.0, '内': 20.0, '外': 16.0}
table = [255 if v < 200 else 0 for v in range(256)]
for i, page in enumerate(doc):
    px = page.get_pixmap(dpi=200)
    img = Image.frombytes('RGB', (px.width, px.height), px.samples).convert('L').point(table)
    bb = img.getbbox()
    if not bb:
        print('  P%d 全白（无墨迹）' % (i + 1))
        continue
    per_px = 25.4 / 200.0
    bx0, by0, bx1, by1 = [v * per_px for v in bb]
    # 转换到成品框坐标：PDF 原点 = 裁切框左上角 - 3mm
    left = bx0 - BLEED_MM
    right = (page.rect.width * 25.4 / 72.0 - BLEED_MM) - (bx1 - BLEED_MM)
    top = by0 - BLEED_MM
    bottom = (page.rect.height * 25.4 / 72.0 - BLEED_MM) - (by1 - BLEED_MM)
    inner, outer = (left, right) if (i % 2 == 0) else (right, left)
    if NO_MARGIN:
        print('  P%d  上%6.1f  下%6.1f  内%6.1f  外%6.1f mm    [仅记录，不判版心]'
              % (i + 1, top, bottom, inner, outer))
        continue
    ok = (top >= MIN['上'] - 0.4 and bottom >= MIN['下'] - 0.4
          and inner >= MIN['内'] - 0.4 and outer >= MIN['外'] - 0.4)
    print('  P%d  上%6.1f  下%6.1f  内%6.1f  外%6.1f mm    %s'
          % (i + 1, top, bottom, inner, outer, '[合格]' if ok else '[小于版心要求]'))
    if not ok:
        bad.append('P%d 边距不足（上%.1f 下%.1f 内%.1f 外%.1f）' % (i + 1, top, bottom, inner, outer))

print('\n=== 最终判定 ===')
print('  ' + ('[合格] 所有页边距均不小于版心要求' if not bad else '[有不合格项]'))
for b in bad:
    print('    -', b)
