# 文字保真核对：把成品 PDF 里抽出的字符与源文件逐字对照
#
# 为什么用 PDF 抽文而不是视觉模型：
#   视觉模型看图片要说先把图降采样，小字会读错——实测把署名「翟翊翔」读成「曹玥玥」、
#   把图注「nomadict」读成「nomadicst」。**视觉模型不用于核对文字**。
#   文字一致性只有一条硬路子：从 PDF 抽字符（page.get_text()），与源文对照。
#
# 用法：
#   python check-text-fidelity.py <成品.pdf> <源文件> [源文件2 ...]
#   一篇文章的文字可能来自多个源文件（正文 md + 作者信息 txt + 图注清单），
#   全部按参数顺序拼起来再比。
#
# 判读：
#   A. 顺序一致=True  → 最理想，字符与顺序都对上
#   B. 如果顺序一致=False 但字符集一致=True → 字符一个没增没删没改，只是版面把阅读顺序换了
#      （例如图注排在正文之后）。这已经足以证明"正文没被改过"。
#   C. 两个都 False → 逐条给出差异，回去查是漏字、改了标点，还是排版过程中手工动过文本。
#
# 注意：版面里的"中西文自动间距"会让抽出文本带多余空格，所以比较前一律去掉所有空白字符。
import html
import io
import re
import sys

import fitz

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

if len(sys.argv) < 3:
    sys.exit('用法: python check-text-fidelity.py <成品.pdf> <源文件> [源文件2 ...]')

pdf_path = sys.argv[1]
src_paths = sys.argv[2:]

IMG = re.compile(r'!\[(.*?)\]\((.*?)\)')


def strip_markup(s):
    """去掉 markdown 标记与 HTML 实体——这些是"格式"，不是作者写的字。"""
    s = html.unescape(s)          # &#x41; → A
    s = s.replace('\u200b', '')   # 零宽空格
    s = IMG.sub('', s)            # 图片链接整体去掉（图是素材，不是文字）
    s = re.sub(r'^\s*#{1,6}\s*', '', s, flags=re.M)   # 标题井号
    s = re.sub(r'^\s*>\s?', '', s, flags=re.M)        # 引用符号
    s = re.sub(r'\*\*(.+?)\*\*', r'\1', s)            # **粗体**
    s = re.sub(r'_([^_\n]+)_', r'\1', s)              # _斜体_
    s = re.sub(r'\[([^\]]*)\]\([^)]*\)', r'\1', s)    # 普通链接只留文字
    return s


def norm(s):
    """只比字符：去掉所有空白（含中西文自动间距产生的空格）。"""
    return re.sub(r'\s+', '', s)


src = norm(''.join(strip_markup(open(p, encoding='utf-8').read()) for p in src_paths))
doc = fitz.open(pdf_path)
got = norm(''.join(p.get_text() for p in doc))

print('=== 文件 ===')
print('成品 :', pdf_path, '（%d 页）' % doc.page_count)
for p in src_paths:
    print('源文 :', p)
print()
print('源文字符数 :', len(src))
print('成品字符数 :', len(got))

order_ok = (src == got)
set_ok = (sorted(src) == sorted(got))

print()
print('A. 字符与顺序完全一致 :', order_ok)
print('B. 字符集完全一致（无增/无删/无改，仅顺序不同）:', set_ok)

if not set_ok:
    from collections import Counter
    cs, cg = Counter(src), Counter(got)
    only_src = ''.join(sorted((cs - cg).elements()))
    only_got = ''.join(sorted((cg - cs).elements()))
    print()
    print('  只出现在源文的字符 :', repr(only_src) or '无')
    print('  只出现在成品的字符 :', repr(only_got) or '无')
    print('  （上面两串是多重集差，含重复计数；全空即字符集一致）')

if not order_ok and set_ok:
    import difflib
    print()
    print('  顺序差异前几处（多为图注/署名在版面上换了位置，不是文字被改）：')
    sm = difflib.SequenceMatcher(None, src, got, autojunk=False)
    shown = 0
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == 'equal':
            continue
        print('    [%s] 源「%.24s」→ 成品「%.24s」' % (tag, src[i1:i2], got[j1:j2]))
        shown += 1
        if shown >= 8:
            print('    …（仅列前 8 处）')
            break

print()
print('=== 关键标点计数（曾被坑过的地方）===')
allok = True
for ch in ['&', '——', '……', '“', '”', '‘', '’', '，', '、', '；', '：', '？', '！', '（', '）', '【', '】', '·']:
    a, b = src.count(ch), got.count(ch)
    flag = 'ok' if a == b else '★不一致'
    if a != b:
        allok = False
    if a or b:
        print('  %-3s 源%-4d 成品%-4d %s' % (ch, a, b, flag))

print()
if order_ok:
    print('[合格] 文字与源文逐字一致（含顺序）')
elif set_ok and allok:
    print('[合格] 字符一个没增没删没改；顺序差异来自版面阅读顺序，需确认这几处是否为有意安排')
else:
    print('[不合格] 存在字符层面的差异，必须逐条查明')
    sys.exit(1)
