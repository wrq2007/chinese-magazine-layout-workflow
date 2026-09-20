# 图注专项检查：墨色对比度 / 折行残字 / 与图的间距一致性
#
# 为什么要有它（2026-09-20 补的盲区）：
#   原来的对比度检查（check-pdf-contrast.py）只覆盖「文字压在照片上」这一种情况——
#   它把文字涂掉、保留位图来取背景。纸白底的图注因此完全不在检查范围内。
#   于是这条漏了：通透 4 页的图注是 `0 0 0 0.62 k`（K62 灰、8.5pt），
#   对纸白的实测对比度只有 4.07:1，低于本项目 4.5:1 的底线，肉眼也确实发灰。
#
# 做法：文字色取 span 的颜色（矢量值，不受渲染分辨率影响），
#       底色取该行包围盒外扩 1.5mm 区域内像素的**中位数**（背景像素占多数，中位数即纸色/底图色）。
#       暗字浅底、浅字暗底两种情况都能用。
#
# 只看不改。用法：python check-caption.py <pdf> [--max-size 9.5]
import io
import re
import sys

import fitz

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

MM = 25.4 / 72.0   # 点 -> 毫米
PT = 72.0 / 25.4   # 毫米 -> 点
DENS = 150         # 取底色用的渲染分辨率
CAPTION_RE = re.compile(r'^图\s*\d')


def lin(v):
    return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4


def lum(rgb):
    r, g, b = (lin(v / 255.0) for v in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(a, b):
    la, lb = lum(a), lum(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


def is_cjk(ch):
    return '\u4e00' <= ch <= '\u9fff' or ch in '，。、；：？！“”（）'


def main():
    args = sys.argv[1:]
    pdf = args[0]
    max_size = 9.5
    if '--max-size' in args:
        max_size = float(args[args.index('--max-size') + 1])

    doc = fitz.open(pdf)
    problems, notes, oks = [], [], []      # problems: (对比度, 描述)
    gaps = []
    n_blocks = 0

    for page in doc:
        pix = page.get_pixmap(dpi=DENS)
        img = pix.pil_image().convert('RGB')
        px = img.load()
        pxpt = DENS / 72.0

        lines = []
        for blk in page.get_text('dict')['blocks']:
            if blk.get('type') != 0:
                continue
            for ln in blk['lines']:
                sps = [s for s in ln['spans'] if s['text'].strip()]
                if not sps:
                    continue
                size = max(s['size'] for s in sps)
                if size > max_size + 0.01:
                    continue
                col = sps[0]['color']
                lines.append({
                    'bbox': ln['bbox'],
                    'text': ''.join(s['text'] for s in sps),
                    'size': size,
                    'rgb': ((col >> 16) & 255, (col >> 8) & 255, col & 255),
                })
        if not lines:
            continue
        lines.sort(key=lambda l: (round(l['bbox'][1], 1), l['bbox'][0]))

        # 纵向相邻、且横向有重叠的行才算同一个图注块（避免把并排两栏图注并成一个）
        # 并块：在同栏（横向有重叠）里找"最近的上一个块"，纵向间隙够小就算同一块。
        # 不能只看紧邻的上一块——并排两栏的图注会交替出现，夹在中间就把折行断开了。
        blocks = []
        for ln in lines:
            cand, best = None, None
            for blk in blocks:
                pb = blk[-1]['bbox']
                if not (pb[2] > ln['bbox'][0] and ln['bbox'][2] > pb[0]):
                    continue
                gap = ln['bbox'][1] - pb[3]
                if 0 <= gap < 2.5 * PT and (best is None or gap < best):
                    cand, best = blk, gap
            if cand is not None:
                cand.append(ln)
            else:
                blocks.append([ln])

        imgs = [i['bbox'] for i in page.get_image_info()]

        for blk in blocks:
            n_blocks += 1
            top = min(l['bbox'][1] for l in blk)
            bot = max(l['bbox'][3] for l in blk)
            left = min(l['bbox'][0] for l in blk)
            right = max(l['bbox'][2] for l in blk)
            ink = blk[0]['rgb']
            text = ''.join(l['text'] for l in blk)
            desc = text[:34]
            is_cap = bool(CAPTION_RE.match(text.strip()))

            pad = 1.5 * PT
            x0 = max(0, int((left - pad) * pxpt))
            x1 = min(img.width - 1, int((right + pad) * pxpt))
            y0 = max(0, int((top - pad) * pxpt))
            y1 = min(img.height - 1, int((bot + pad) * pxpt))
            vals = []
            for y in range(y0, y1 + 1, 2):
                for x in range(x0, x1 + 1, 2):
                    vals.append(px[x, y])
            if not vals:
                continue
            vals.sort(key=lambda p: lum(p))
            med = vals[len(vals) // 2]
            cr = contrast(ink, med)

            head = 'P%d %.1fpt  对比度 %5.2f:1  墨色 rgb%s  底色 rgb%s  「%s」' % (
                page.number + 1, blk[0]['size'], cr, ink, med, desc)
            if cr < 4.5:
                problems.append((cr, head))
            else:
                oks.append(head)

            if len(blk) > 1:
                last = blk[-1]['text'].strip()
                ncjk = sum(1 for ch in last if is_cjk(ch))
                words = last.split()
                if (ncjk and ncjk <= 3) or (len(words) == 1 and not ncjk):
                    notes.append('图注折行后末行只剩「%s」（P%d %.1fpt）——孤字/残词成行'
                                 % (last, page.number + 1, blk[0]['size']))

            if is_cap:
                above = [b for b in imgs
                         if b[3] <= top + 0.5 and b[2] > left and b[0] < right]
                if above:
                    b = max(above, key=lambda z: z[3])
                    g = (top - b[3]) * MM
                    if 0 <= g <= 10.0:
                        gaps.append((page.number + 1, round(g, 2), desc[:16]))

    print('=== 图注/小字：墨色对比度（文字色 × 实测底色）===')
    for l in oks:
        print('  ' + l)
    for _, l in problems:
        print('  ' + l)

    print()
    print('=== 图注：与上方图片的间距（只统计以「图N」开头的图注块）===')
    spread = 0.0
    if gaps:
        vals = [g[1] for g in gaps]
        for pno, g, d in gaps:
            print('  P%d  间距 %5.2fmm  「%s」' % (pno, g, d))
        spread = max(vals) - min(vals)
        print('  离散度 %.2fmm（最大 - 最小）' % spread)
    else:
        print('  （没有"图注明正上方是图片"的组合）')

    print()
    print('=== 判定 ===')
    if n_blocks == 0:
        print('  [注意] 没有识别到图注（组里没有 <=%.1fpt 的文字）——本项跳过' % max_size)
        return 0
    if not problems and not notes and spread <= 0.5:
        print('  [合格] %d 个图注块：对比度均 >=4.5:1，无残字成行，间距离散 <=0.5mm' % n_blocks)
    for n in notes:
        print('  [注意] ' + n)
    if gaps and spread > 0.5:
        print('  [注意] 图注与图的间距不一致，离散度 %.2fmm —— 逐条对齐到同一个值' % spread)
    if problems:
        worst_cr, worst_head = min(problems)
        print('  [需处理] %d 个图注块对比度 <4.5:1（最差 %.2f:1）' % (len(problems), worst_cr))
        print('           最差的一条：%s' % worst_head)
        print()
        print('  改法：纸白底的图注若用 K62 这类浅灰，8.5pt 会低于 4.5:1。')
        print('        加深到 K75–K80（或直接用 K100）；字色深浅不要靠"看着差不多"定。')
    return 1 if problems else 0


if __name__ == '__main__':
    sys.exit(main())