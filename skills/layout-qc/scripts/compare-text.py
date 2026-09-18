# 逐字比对（非标准流程，按需使用）：把成品文字与源文件文字做 diff。
# 常规流程不跑它——文本只复制粘贴、不改一个字，就不需要事后比对；
# 只有在"文本曾被人手处理过"或怀疑被改动时才拿它兜底。
# 用法：python compare-text.py <源文件.docx> <成品文字.txt>
# 成品文字用 InDesign 导出：story.contents 写入 UTF-8 文本即可
import re, html, sys, zipfile, difflib

def docx_text(path):
    with zipfile.ZipFile(path) as z:
        xml = z.read('word/document.xml').decode('utf-8')
    xml = xml.replace('</w:p>', '\n')
    xml = re.sub(r'<w:br[^>]*/>', '\n', xml)
    return html.unescape(re.sub(r'<[^>]+>', '', xml))

def norm(s):
    return re.sub(r'\s+', '', s.replace('\u000b', '').replace('\u00a0', ' '))

if len(sys.argv) < 3:
    print('用法: python compare-text.py <源.docx> <成品.txt>')
    sys.exit(2)

src = norm(docx_text(sys.argv[1]))
with open(sys.argv[2], encoding='utf-8') as f:
    built = norm(f.read())

print('源文字数       :', len(src))
print('成品文字数     :', len(built))
print('字符多重集一致 :', sorted(src) == sorted(built))

sm = difflib.SequenceMatcher(None, src, built)
if sm.ratio() >= 1.0:
    print('逐字一致（仅顺序/空白差异）')
else:
    print('相似度         :', round(sm.ratio(), 6))
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag != 'equal':
            print('  [' + tag + '] 源「' + src[i1:i2] + '」 → 成品「' + built[j1:j2] + '」')

# 特殊字符最容易在改写中丢失：逐个核对出现次数
for ch in ['&', '·', '—', '…', '“', '”', '（', '）']:
    a, b = src.count(ch), built.count(ch)
    if a != b:
        print('  ★ ' + ch + ' : 源', a, '/ 成品', b)
