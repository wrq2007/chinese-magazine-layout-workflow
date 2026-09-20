# 印前硬指标：文字墨色审计——文字用的是哪几个色版
#
# 为什么要有它（2026-09-20 补的盲区）：
#   原来的 qc-all 只量位图 TAC、只量「压图反白」文字的对比度，
#   完全不看**文字本身用什么色版印**。于是有一类问题一直漏检：
#   小字用两三个色版叠色（四色黑，或三色版叠出来的浅灰），
#   四个色版套印只要偏 0.1mm，8-9pt 的字边就出现彩边。
#
#   实例（发刊词 2026-09-20 实测）：全篇 1309 字的填充色是
#   `0.03 0.027 0.043 0 k` / `0.075 0.048 0.042 0 k` / `0.151 0.105 0.104 0 k`
#   ——K 通道全是 0，`g` 与 `K` 算符 0 次。也就是说设计时定的"近白"，
#   印出来其实是三色版叠的浅灰；而当时所有例行检查都是绿的。
#
# 做法：把页面内容流按 BT…ET 切开——BT/ET 之间是文字绘制，之外的填充是矢量装饰。
# 两边分开统计，只对「文字」那一侧下判定，避免把装饰线误判成小字墨色。
#
# 只看不改。用法：python check-text-ink.py <pdf>
import io
import re
import sys
from collections import Counter

import fitz

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

EPS = 0.02  # 通道值小于 2% 视为「没上这个版」

KPAT = re.compile(rb'([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) k(?![A-Za-z])')
GPAT = re.compile(rb'(?<![\d.])([\d.]+) g(?![A-Za-z])')


def split_text_blocks(data):
    """返回 (text_chunks, graphic_chunks)。BT…ET 之间算文字。"""
    text, graphic = [], []
    pos = 0
    while True:
        i = data.find(b'BT', pos)
        if i < 0:
            graphic.append(data[pos:])
            return text, graphic
        j = data.find(b'ET', i)
        if j < 0:
            graphic.append(data[pos:])
            return text, graphic
        graphic.append(data[pos:i])
        text.append(data[i:j])
        pos = j + 2


def describe(vals):
    c, m, y, k = vals
    plates = [n for n, v in zip('CMYK', vals) if v > EPS]
    pct = 'C%d M%d Y%d K%d' % tuple(round(v * 100) for v in vals)
    if not plates:
        return 'PAPER', '纸白（无墨）', pct
    if plates == ['K']:
        return 'K_ONLY', '单色黑 K%d%%' % round(k * 100), pct
    if len(plates) == 4:
        return 'RICH_BLACK', '四色黑（四版都有）', pct
    if 'K' in plates:
        return 'MULTI', '多色版叠色（含 K）', pct
    return 'MULTI_NO_K', '多色版叠浅色（K=0）', pct


def collect(data_list):
    fills = Counter()
    grays = 0
    for data in data_list:
        for m in KPAT.finditer(data):
            fills[tuple(float(x) for x in m.groups())] += 1
        grays += len(GPAT.findall(data))
    return fills, grays



def main():
    doc = fitz.open(sys.argv[1])

    text_fills, text_gray = Counter(), 0
    gfx_fills, gfx_gray = Counter(), 0
    for page in doc:
        t, g = split_text_blocks(page.read_contents())
        a, ag = collect(t)
        b, bg = collect(g)
        text_fills.update(a)
        text_gray += ag
        gfx_fills.update(b)
        gfx_gray += bg

    print('=== 文字墨色（BT…ET 之间实测的填充色）===')
    if not text_fills and not text_gray:
        print('  （没有文字填充算符——可能整页是位图）')
    rows = []
    for vals, n in text_fills.most_common():
        kind, label, pct = describe(vals)
        rows.append((kind, label, pct, n))
        print('  %-22s %-22s 出现 %2d 次' % (label, pct, n))
    if text_gray:
        print('  [注意] 有 %d 处文字用灰度 g 算符（未按 CMYK 管理，印刷端会自行转换）' % text_gray)

    if gfx_fills:
        print()
        print('=== 矢量装饰色（BT…ET 之外，不属于文字，仅记录）===')
        for vals, n in gfx_fills.most_common():
            kind, label, pct = describe(vals)
            print('  %-22s %-22s 出现 %d 次' % (label, pct, n))

    print()
    print('=== 判定（只判文字）===')
    bad, warn = [], []
    for kind, label, pct, n in rows:
        if kind == 'RICH_BLACK':
            bad.append('文字用四色黑（%s）——四版套印偏差会直接显成彩边，'
                       '正文与小字必须改单色黑 K100' % pct)
        elif kind == 'MULTI_NO_K':
            warn.append('文字用多色版叠浅色（%s）——反白/浅色小字建议改为纸白（0,0,0,0）'
                        '或单通道；否则套印偏差会显成彩边，且实际印出来比设计值更浅' % pct)
        elif kind == 'MULTI':
            warn.append('文字用多色版叠色且含 K（%s），check 一下是不是想用四色黑' % pct)

    if not bad and not warn:
        print('  [合格] 文字只用单色黑或纸白，未发现四色黑与多色版叠色')
    for w in warn:
        print('  [注意] ' + w)
    for b in bad:
        print('  [需处理] ' + b)
    if warn or bad:
        print()
        print('  改法：InDesign 里把文字色改成「单色黑 K100」（或反白稿用纸白），'
              '再经 pdfDestinationProfile 导出；不要用"深灰/近白"这种叠色定义。')
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())