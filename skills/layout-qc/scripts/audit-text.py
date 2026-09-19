# 排版**之前**的文字审计：查错别字、语法、标点、用词。
#
# 分工（用户定的）：本地模型出初筛 → Codex 逐条核实与过滤 → 输出成表给用户确认。
# 为什么由本地模型做：这是"读文字找问题"，不碰几何、不碰 API，正好是它的强项，
# 而且 0 费用；几何与执行仍归脚本与云端模型。
#
# 用法：
#   python audit-text.py <源文.md|txt> [--url http://127.0.0.1:8080/v1/chat/completions]
#                                   [--chunk 900]   每批送多少字
#                                   [--out 记录.md]
# 输出：逐条 `【类型】原句片段 → 问题 → 建议`，附模型原始回答留档，供人工核实。
import argparse
import io
import json
import os
import re
import sys
import time
import urllib.request

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

SYSTEM = (
    '你是中文校对员。下面是一本中学刊物文章的正文（作者是高中生，文风偏口语化）。\n'
    '请逐句检查，**只报确实有问题的地方**：\n'
    '① 错别字（含形近字、同音字误用）\n'
    '② 语法错误（成分残缺、搭配不当、语序不当、关联词误用、重复用词）\n'
    '③ 标点误用（含全角半角混用、缺标点、标点连用不当）\n'
    '④ 用词不当、前后矛盾、指代不明\n'
    '\n'
    '输出格式：每条一行，写 `【类型】原句片段 → 问题说明 → 建议改法`。\n'
    '要求：原句片段必须与原文**逐字一致**（便于定位）；只改错处，不要整段重写；\n'
    '不要提写作风格、修辞、内容增删的建议——那是编辑的事，不是校对的事。\n'
    '没有问题就写「无」。不要客套，不要复述原文。'
)


def ask(url, text, timeout=1800):
    body = {'model': 'local', 'messages': [
        {'role': 'user', 'content': SYSTEM + '\n\n【待校对文字】\n' + text}],
        'max_tokens': 8000, 'temperature': 0.2}
    req = urllib.request.Request(url, data=json.dumps(body).encode('utf-8'),
                                 headers={'Content-Type': 'application/json'}, method='POST')
    with urllib.request.urlopen(req, timeout=timeout) as r:
        d = json.loads(r.read().decode('utf-8'))
    m = d['choices'][0]['message']
    if not (m.get('content') or '').strip():
        return '(空回复) finish_reason=%s —— 检查 max_tokens 是否被思维链吃光' % d['choices'][0].get('finish_reason')
    return m['content'].strip()


def chunks(text, size):
    """按段落切批，尽量不切在段落中间。"""
    out, cur = [], ''
    for para in text.split('\n'):
        if len(cur) + len(para) > size and cur:
            out.append(cur)
            cur = ''
        cur += para + '\n'
    if cur.strip():
        out.append(cur)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src')
    ap.add_argument('--url', default='http://127.0.0.1:8080/v1/chat/completions')
    ap.add_argument('--chunk', type=int, default=900)
    ap.add_argument('--out', default='')
    a = ap.parse_args()

    text = open(a.src, encoding='utf-8').read()
    # 去掉 markdown 语法与图片链接，只留作者写的文字
    text = re.sub(r'!\[.*?\]\(.*?\)', '', text)
    text = re.sub(r'^\s*#{1,6}\s*', '', text, flags=re.M)
    text = re.sub(r'^\s*>\s?', '', text, flags=re.M)
    text = re.sub(r'\*\*(.+?)\*\*', r'\1', text)

    parts = chunks(text, a.chunk)
    print('待校对 %d 字，分 %d 批，端点 %s\n' % (len(text.replace('\n', '')), len(parts), a.url))
    log = ['# 文字审计记录 %s\n\n- 源文：%s\n- 端点：%s\n' % (time.strftime('%Y-%m-%d %H:%M'), a.src, a.url)]
    findings = []
    for i, part in enumerate(parts):
        t = time.time()
        ans = ask(a.url, part)
        print('===== 第 %d 批（%.1fs）=====' % (i + 1, time.time() - t))
        print(ans)
        print()
        log.append('\n## 第 %d 批\n\n**送检文字**\n\n%s\n\n**模型回答**\n\n%s\n' % (i + 1, part.strip(), ans))
        for line in ans.splitlines():
            if line.strip().startswith('【'):
                findings.append(line.strip())

    out = a.out or os.path.join(os.path.dirname(os.path.abspath(a.src)), '_review',
                                '文字审计-%s.md' % time.strftime('%Y%m%d-%H%M%S'))
    os.makedirs(os.path.dirname(out), exist_ok=True)
    open(out, 'w', encoding='utf-8').write('\n'.join(log))
    print('=' * 70)
    print('汇总 %d 条待人工核实（**未经核实不得直接采信**）：' % len(findings))
    for f in findings:
        print('  ' + f)
    print('\n完整记录：%s' % out)


if __name__ == '__main__':
    main()
