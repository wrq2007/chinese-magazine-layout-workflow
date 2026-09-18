# 把源文（docx / md / txt）解析成段落数组，供排版脚本直接取用——文本不经过人手，避免重打丢失字符
# 用法: python extract-text.py <源文件> <工作目录>
# 产出: <工作目录>/paragraphs.json （段落数组）
#       <工作目录>/source-text.txt （归一化全文，供复核或后续取用）
#       <工作目录>/piece.suggest.json （配置骨架：自动猜标题与署名范围，人工只需确认几个索引）
import json, os, re, html, sys, zipfile

def read_text(path):
    low = path.lower()
    if low.endswith('.docx'):
        with zipfile.ZipFile(path) as z:
            xml = z.read('word/document.xml').decode('utf-8')
        xml = xml.replace('</w:p>', '\n')
        xml = re.sub(r'<w:br[^>]*/>', '\n', xml)
        return html.unescape(re.sub(r'<[^>]+>', '', xml))
    with open(path, encoding='utf-8', errors='ignore') as f:
        return f.read()

def paragraphs_of(text):
    out = []
    for raw in text.replace('\u000b', '\n').split('\n'):
        s = re.sub(r'[ \t\u00a0]+', '', raw).strip()
        if s:
            out.append(s)
    return out

def guess_signature(paras):
    """从尾部往前找"像署名"的段落：短、无句末标点、含常见署名特征。"""
    keys = re.compile(r'级|班|社|副社长|社长|老师|指导|摄影|撰文|供稿|20\d\d|\.')
    idx = len(paras)
    while idx > 0 and len(paras) - idx < 6:
        p = paras[idx - 1]
        if len(p) <= 24 and not re.search(r'[。！？]$', p) and (keys.search(p) or len(p) <= 6):
            idx -= 1
        else:
            break
    return idx

def main():
    src, work = sys.argv[1], sys.argv[2]
    os.makedirs(work, exist_ok=True)
    paras = paragraphs_of(read_text(src))
    with open(os.path.join(work, 'paragraphs.json'), 'w', encoding='utf-8') as f:
        json.dump(paras, f, ensure_ascii=False, indent=1)
    with open(os.path.join(work, 'source-text.txt'), 'w', encoding='utf-8') as f:
        f.write(''.join(paras))

    sig_from = guess_signature(paras)
    suggest = {
        "titleIndex": 0,
        "kicker": "",
        "bodyFromIndex": 1,
        "signatureFromIndex": sig_from,
        "signatureArrange": [[i] for i in range(sig_from, len(paras))] or [None],
        "signatureJoin": "·",
        "_note": "signatureArrange 每项 = 源段索引列表（多项用 signatureJoin 连接），用于把署名重排成层级；文本永远取自 paragraphs.json，不要手打"
    }
    with open(os.path.join(work, 'piece.suggest.json'), 'w', encoding='utf-8') as f:
        json.dump(suggest, f, ensure_ascii=False, indent=1)

    print(f'段落数={len(paras)}  正文字数={sum(len(p) for p in paras)}')
    print(f'标题={paras[0][:20]}')
    print(f'署名起止：第 {sig_from+1} 段起（共 {len(paras)-sig_from} 段）')
    for i in range(sig_from, len(paras)):
        print(f'  [{i}] {paras[i]}')
    print('已写出 paragraphs.json / source-text.txt / piece.suggest.json')

if __name__ == '__main__':
    main()
