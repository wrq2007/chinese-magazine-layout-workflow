# 装饰元素一致性检查：把版面上所有"细长填充矩形"（分割线/竖线）量出来，
# 按「宽度 × 粗细 × 颜色」分组，检查同类装饰是否用了同一规格。
#
# 为什么需要它：装饰线最容易"每条都不一样"——这条 36mm/1.6pt、那条 30mm/1.4pt，
# 单看每一页都合理，翻页对比就露馅，而肉眼逐页看很难发现。实测《通透》就踩过。
#
# 用法：python check-accent-rules.py <成品.pdf>
import io
import sys

import fitz

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

pdf = sys.argv[1]
doc = fitz.open(pdf)

lines = []          # 横线：宽 >8mm、高 <1.5mm
verticals = []      # 竖线：宽 <1.5mm、高 4–30mm
for pno in range(doc.page_count):
    for dr in doc[pno].get_drawings():
        r = dr['rect']
        w = r.width * 25.4 / 72
        h = r.height * 25.4 / 72
        fill = dr.get('fill')
        if fill is None:
            continue
        col = '#%02X%02X%02X' % tuple(int(round(c * 255)) for c in fill)
        if w > 8 and h < 1.5:
            lines.append((pno + 1, round(w, 1), round(h, 2), col, round(r.x0 * 25.4 / 72 - 3, 1), round(r.y0 * 25.4 / 72 - 3, 1)))
        elif w < 1.5 and 4 < h < 30:
            verticals.append((pno + 1, round(w, 2), round(h, 1), col, round(r.x0 * 25.4 / 72 - 3, 1), round(r.y0 * 25.4 / 72 - 3, 1)))


def report(title, items, key):
    print('=== %s（%d 条）===' % (title, len(items)))
    for pno, w, h, col, x, y in items:
        print('  P%d  %s  x起%6.1f  y%6.1f' % (pno, key(w, h, col), x, y))
    specs = {}
    for pno, w, h, col, x, y in items:
        specs.setdefault(key(w, h, col), []).append('P%d' % pno)
    print()
    if len(specs) <= 1:
        print('  [合格] 同类装饰规格一致')
    else:
        print('  [不一致] 同类装饰出现 %d 种规格：' % len(specs))
        for s, pages in specs.items():
            print('     %s  →  %s' % (s, '、'.join(pages)))
        print('  → 装饰元素必须立规则：同类线保持同宽、同粗、同色、同间距。')
    print()


report('横线（分割线）', lines, lambda w, h, c: '宽%.1fmm × 粗%.2fmm  %s' % (w, h, c))
report('竖线（引文线等）', verticals, lambda w, h, c: '粗%.2fmm × 高%.1fmm  %s' % (w, h, c))
