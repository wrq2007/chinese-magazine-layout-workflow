# 一条命令跑完全部验收，输出一张「项 / 实测 / 判定」表。
#
# 为什么要有它：以前每个检查单独跑，结论散在五处；把成品交给复核模型时，
# 模型得自己读 PDF、自己写量测脚本、再推理——单次 40k–80k token。
# 现在量测全部由脚本做完，模型只需读这一张表判断，量级降到 5k–10k。
#
# 用法：
#   python qc-all.py <成品.pdf> [--sources 源文1 源文2 ...] [--json]
#   例：python qc-all.py 通透_185x260_紧凑4页.pdf --sources 通透.md 作者信息.txt _build/captions.txt
#
# 判定口径：脚本自己下判定，不依赖模型。任何一项不合格都会在最后的汇总里列出。
import argparse
import io
import json
import os
import re
import subprocess
import sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
HERE = os.path.dirname(os.path.abspath(__file__))

CHECKS = [
    ('页面盒 / 出血 / 图像 DPI', 'check-pdf-print.py',
     [r'\[合格\] 成品框', r'\[不合格\]']),
    ('实际边距（墨迹反推）', 'check-pdf-print.py',
     [r'^  P\d+\s+上.*\[合格\]', r'\[小于版心要求\]']),
    ('内嵌字体', 'check-pdf-print.py', [r'嵌入方式=']),
    ('装饰元素一致性', 'check-accent-rules.py',
     [r'\[合格\] 同类装饰规格一致', r'\[不一致\]']),
    ('孤字成行', 'check-orphan.py',
     [r'\[合格\] 没有段落以', r'\[孤字\]', r'末行仅']),
    ('总墨量 TAC', 'check-tac.py', [r'\[合格\] 所有位图', r'\[需处理\]', r'\[注意\] 贴线']),
    ('文字墨色（色版构成）', 'check-text-ink.py',
     [r'\[合格\] 文字只用单色黑', r'\[注意\] 文字用', r'\[需处理\] 文字用四色黑']),
    ('输出意图 / 色彩管理', 'check-output-intent.py',
     [r'\[合格\] 已内嵌输出意图', r'\[注意\] PDF 没有内嵌输出意图']),
    ('图注（对比度/残字/间距）', 'check-caption.py',
     [r'\[合格\] \d+ 个图注块', r'\[注意\] 图注', r'\[需处理\] \d+ 个图注块']),
]


def run(script, args):
    p = os.path.join(HERE, script)
    if not os.path.exists(p):
        return None
    r = subprocess.run([sys.executable, p] + args, capture_output=True)
    return r.stdout.decode('utf-8', 'replace')


def pick(text, patterns):
    if text is None:
        return ['（脚本不存在）']
    out = []
    for line in text.splitlines():
        for pat in patterns:
            if re.search(pat, line):
                out.append(line.strip())
                break
    return out


def verdict(lines):
    joined = ' '.join(lines)
    if '（脚本不存在）' in joined:
        return 'SKIP'
    if re.search(r'\[不合格\]|\[不一致\]|\[需处理\]|\[小于版心要求\]', joined):
        return 'FAIL'
    if re.search(r'\[注意\]', joined):
        return 'WARN'
    if re.search(r'\[合格\]', joined):
        return 'PASS'
    return 'INFO'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('pdf')
    ap.add_argument('--sources', nargs='*', default=[], help='文字保真核对用的源文件')
    ap.add_argument('--json', action='store_true')
    ap.add_argument('--no-margin', action='store_true',
                    help='满版出血件（背景图铺到出血边）用它：跳过"实际边距"的版心判定')
    a = ap.parse_args()

    results = []
    cache = {}

    def get(script, args):
        key = (script, tuple(args))
        if key not in cache:
            cache[key] = run(script, args)
        return cache[key]

    extra = ['--no-margin'] if a.no_margin else []
    for name, script, pats in CHECKS:
        lines = pick(get(script, [a.pdf] + extra), pats)
        results.append((name, verdict(lines), lines))

    if a.sources:
        lines = pick(get('check-text-fidelity.py', [a.pdf] + a.sources),
                     [r'源文字符数', r'成品字符数', r'\[合格\]', r'\[不合格\]', r'只出现在'])
        results.append(('文字保真（PDF 抽字）', verdict(lines), lines))
    else:
        results.append(('文字保真（PDF 抽字）', 'SKIP', ['（未提供 --sources，跳过）']))

    failed = [r for r in results if r[1] == 'FAIL']
    warned = [r for r in results if r[1] == 'WARN']

    if a.json:
        print(json.dumps({'pdf': a.pdf, 'pass': not failed,
                          'warn': [n for n, _, _ in warned],
                          'checks': [{'name': n, 'verdict': v, 'evidence': l} for n, v, l in results]},
                         ensure_ascii=False, indent=1))
        return 0 if not failed else 1

    print('=' * 78)
    print('验收汇总：%s' % os.path.basename(a.pdf))
    print('=' * 78)
    for name, v, lines in results:
        mark = {'PASS': '合格', 'FAIL': '不合格', 'WARN': '注意', 'SKIP': '跳过', 'INFO': '记录'}[v]
        print('\n【%s】%s' % (mark, name))
        for l in lines[:6]:
            print('    ' + l)
        if len(lines) > 6:
            print('    …（另 %d 条同项记录）' % (len(lines) - 6))
    print('\n' + '=' * 78)
    if failed:
        print('总判定：[有不合格项] ' + '、'.join(n for n, _, _ in failed))
        if warned:
            print('另有需注意：' + '、'.join(n for n, _, _ in warned))
        return 1
    if warned:
        print('总判定：[无不合格，但有 %d 项需注意] %s'
              % (len(warned), '、'.join(n for n, _, _ in warned)))
        return 0
    print('总判定：[全部合格]')
    return 0


if __name__ == '__main__':
    sys.exit(main())
