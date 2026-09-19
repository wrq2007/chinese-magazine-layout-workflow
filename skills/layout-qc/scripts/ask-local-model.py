# 让本地部署的多模态模型做版面视觉复核（llama.cpp / llama-server，或任何 OpenAI 兼容端点）
#
# 为什么是"脚本 + 文件"而不是"聊天"：
#   本地 llama-server 是无状态的——停服务就忘。所谓"长期记忆"只能落在文件上：
#   每次调用都把「前情提要」和「长期记忆」两份 markdown 塞进上下文，再附当前页面图。
#   这样它既不会忘，你也能直接翻看它到底记住了什么、随手改。
#
# 用法：
#   python ask-local-model.py <成品.pdf> --brief 前情提要.md --memory 长期记忆.md
#   可选：--url http://127.0.0.1:8080/v1/chat/completions  --dpi 150  --max-tokens 6000
#         --pages 1-2        只审指定页
#         --out 记录.md      指定记录文件（默认写到 <pdf目录>/_review/ 下）
#
# ⚠️ 两个实测坑：
#   1. 推理模型（返回里有 reasoning_content 的那种）会把 max_tokens 先吃掉——
#      给 1800 会返回空正文（finish_reason=length），**至少给 6000**。
#   2. 图片会被缩放，小字必然读错。所以提示里要明确"不要逐字抄录页面文字"，
#      文字一致性一律另用 check-text-fidelity.py 走 PDF 抽字核对。
import argparse
import base64
import io
import json
import os
import sys
import time
import urllib.request
from datetime import datetime

import fitz
from PIL import Image

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')


def read(p):
    return open(p, encoding='utf-8').read() if p and os.path.exists(p) else ''


def png_b64(im):
    buf = io.BytesIO()
    im.save(buf, format='PNG')
    return base64.b64encode(buf.getvalue()).decode()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('pdf')
    ap.add_argument('--brief', default='', help='前情提要（规格、硬规矩、已定事项）')
    ap.add_argument('--memory', default='', help='长期记忆（已确认的决定 / 已改过的问题）')
    ap.add_argument('--task', default='请按前情提要里的要求评审这一页，只提审美与排印规范问题。')
    ap.add_argument('--url', default='http://127.0.0.1:8080/v1/chat/completions')
    ap.add_argument('--model', default='local')
    ap.add_argument('--dpi', type=int, default=150)
    ap.add_argument('--max-side', type=int, default=1500, help='送图长边上限')
    ap.add_argument('--max-tokens', type=int, default=6000, help='推理模型必须给足，否则返回空')
    ap.add_argument('--pages', default='', help='如 1-2，默认全部')
    ap.add_argument('--out', default='')
    a = ap.parse_args()

    doc = fitz.open(a.pdf)
    if a.pages:
        lo, _, hi = a.pages.partition('-')
        pages = range(int(lo) - 1, int(hi or lo))
    else:
        pages = range(doc.page_count)

    header = ('以下两段是本次评审的背景，请务必先读完再回答。\n\n'
              '========== 前情提要 ==========\n' + read(a.brief) +
              '\n\n========== 长期记忆（已确认的决定 / 已改过的问题）==========\n' + read(a.memory) +
              '\n\n========== 本轮任务 ==========\n')

    log = ['# 本地模型版面复核 %s\n\n- 源文件：%s\n- 端点：%s\n- 送图：%d dpi，长边 ≤%d\n\n'
           % (datetime.now().strftime('%Y-%m-%d %H:%M'), a.pdf, a.url, a.dpi, a.max_side)]

    for i in pages:
        px = doc[i].get_pixmap(dpi=a.dpi)
        im = Image.frombytes('RGB', (px.width, px.height), px.samples)
        if max(im.size) > a.max_side:
            k = a.max_side / float(max(im.size))
            im = im.resize((int(im.width * k), int(im.height * k)), Image.LANCZOS)
        q = header + '下面是第 %d 页（共 %d 页）的渲染图。%s' % (i + 1, doc.page_count, a.task)
        body = {'model': a.model, 'messages': [{'role': 'user', 'content': [
            {'type': 'text', 'text': q},
            {'type': 'image_url', 'image_url': {'url': 'data:image/png;base64,' + png_b64(im)}}]}],
            'max_tokens': a.max_tokens, 'temperature': 0.3}
        req = urllib.request.Request(a.url, data=json.dumps(body).encode('utf-8'),
                                     headers={'Content-Type': 'application/json'}, method='POST')
        t = time.time()
        try:
            with urllib.request.urlopen(req, timeout=1800) as r:
                d = json.loads(r.read().decode('utf-8'))
            msg = d['choices'][0]['message']
            ans = (msg.get('content') or '').strip()
            if not ans:
                ans = '(空回复) 检查 max_tokens 是否被思维链吃光；finish_reason=%s' % d['choices'][0].get('finish_reason')
        except Exception as e:
            ans = '调用失败：%s' % e
        print('\n===== 第 %d 页（%.1fs）=====' % (i + 1, time.time() - t))
        print(ans)
        log.append('\n## 第 %d 页（%.1fs）\n\n%s\n' % (i + 1, time.time() - t, ans))

    out = a.out or os.path.join(os.path.dirname(os.path.abspath(a.pdf)), '_review',
                                '本地模型复核-%s.md' % datetime.now().strftime('%Y%m%d-%H%M%S'))
    os.makedirs(os.path.dirname(out), exist_ok=True)
    open(out, 'w', encoding='utf-8').write('\n'.join(log))
    print('\n完整记录已写入: %s' % out)


if __name__ == '__main__':
    main()
