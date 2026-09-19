# 中文排印检查：孤字成行（段落最后一行只剩 1–2 个字）
# 依据：AGENTS.md 的内容层细则里列了「孤字成行」；中文排版视之为硬伤。
# 做法：正文段首有 2 字缩进，据此把行分组为段落，再看每段最后一行的字数。
import io
import re
import sys

import fitz

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

pdf = sys.argv[1]
doc = fitz.open(pdf)

print('=== 孤字成行检查（正文段落最后一行 ≤2 字）===')
total = 0
orphans = []
for pno in range(doc.page_count):
    page = doc[pno]
    lines = []
    for blk in page.get_text('dict')['blocks']:
        for ln in blk.get('lines', []):
            txt = ''.join(s['text'] for s in ln['spans'])
            t = txt.strip()
            if not t or not re.search(r'[\u4e00-\u9fa5]', t):
                continue
            x = ln['bbox'][0] * 25.4 / 72 - 3
            y = ln['bbox'][1] * 25.4 / 72 - 3
            # 只取正文行：按本稿实际字号（正文 11pt）。这一步会把小标题（16pt）、
            # 主标题（33pt）、引文（18pt）、图注（8.5pt）排除掉——
            # 否则两字小标题「引言」会被误报成"末行只剩 2 字"。
            size = max(s['size'] for s in ln['spans'])
            if not (10.4 <= size <= 11.6):
                continue
            lines.append((round(y, 1), round(x, 1), t))
    lines.sort()
    if not lines:
        continue
    x0 = min(x for _, x, _ in lines)          # 段首缩进行的 x 起点更大
    indent_x = sorted(set(x for _, x, _ in lines))
    base = indent_x[0]
    # 按"缩进行 = 新段首"切段
    paras = []
    cur = []
    for y, x, t in lines:
        if x > base + 3 and cur:              # 明显右移 → 新的一段的段首
            paras.append(cur)
            cur = []
        elif x > base + 3 and not cur:
            pass
        cur.append((y, x, t))
    if cur:
        paras.append(cur)
    print('  P%d 识别到 %d 段' % (pno + 1, len(paras)))
    for para in paras:
        total += 1
        last = para[-1][2]
        chars = re.findall(r'[\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef]', last)
        n = len(chars)
        if n <= 2:
            orphans.append((pno + 1, para[-1][0], last, n))

print()
print('=== 结果 ===')
print('  受检正文段数: %d' % total)
if not orphans:
    print('  [合格] 没有段落以 1–2 字收尾')
else:
    for pno, y, t, n in orphans:
        print('  P%d  y=%6.1fmm  末行仅 %d 字: 「%s」' % (pno, y, n, t))
    print('  → 处理办法：把该段所在文本框的宽度微调 1–2mm，让最后一个字挤回上一行；')
    print('     或在 InDesign 里对该段开启「视觉边距对齐」/ 允许标点挤压。')
