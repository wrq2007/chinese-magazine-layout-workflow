# 局部放大复核：把成品 PDF 的指定区域按 300dpi 裁下来，交给视觉模型回答一个聚焦问题
#
# 为什么需要它（2026-09《通透》实测）：
#   1) 整页图交给视觉模型会被下采样，小字会读错——把署名「翟翊翔」读成「曹玥玥」，
#      把图注「nomadict」读成「nomadicst」。关键字符串必须放大后再问一次。
#   2) 长文本页会让推理模型把 token 全烧在思考上，返回空；拆成上下两块裁切就能问出来。
#   3) 专项复核（比如"这条竖线有没有压到字"）用局部裁切比整页可靠得多。
#
# 用法：
#   python verify-page-crop.py <pdf> <页号> <x0> <y0> <x1> <y1> "<问题>"
#   坐标单位 mm，相对"成品框左上角"；脚本会自动加上 3mm 出血偏移。
# 需要环境变量 DEEPSEEK_API_KEY。
import base64, io, json, os, sys, time, urllib.request

import fitz

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
PT = 72.0 / 25.4          # 1mm = 2.8346pt
BLEED_MM = 3.0            # 成品 PDF 四周各 3mm 出血

if len(sys.argv) < 7:
    sys.exit('用法: python verify-page-crop.py <pdf> <页号> <x0> <y0> <x1> <y1> "<问题>"')

pdf_path, page_no = sys.argv[1], int(sys.argv[2])
x0, y0, x1, y1 = [float(v) for v in sys.argv[3:7]]
question = sys.argv[7]

key = os.environ.get('DEEPSEEK_API_KEY')
if not key:
    import subprocess
    key = subprocess.run(['powershell', '-Command',
                          "[Environment]::GetEnvironmentVariable('DEEPSEEK_API_KEY','User')"],
                         capture_output=True, text=True).stdout.strip()
if not key:
    sys.exit('未找到 DEEPSEEK_API_KEY')

doc = fitz.open(pdf_path)
px = doc[page_no - 1].get_pixmap(dpi=300, clip=fitz.Rect(
    (x0 + BLEED_MM) * PT, (y0 + BLEED_MM) * PT,
    (x1 + BLEED_MM) * PT, (y1 + BLEED_MM) * PT))
print('裁切：第%d页 %.0f,%.0f–%.0f,%.0f mm → %d×%d px' % (page_no, x0, y0, x1, y1, px.width, px.height))

body = {
    'model': 'deepseek-flash',
    'messages': [{'role': 'user', 'content': [
        {'type': 'text', 'text': question},
        {'type': 'image_url', 'image_url': {
            'url': 'data:image/png;base64,' + base64.b64encode(px.tobytes('png')).decode()}},
    ]}],
    # 推理模型的思维链会吃掉额度：整页长文本给 9000 都可能返回空，局部裁切 12000 足够
    'max_tokens': 12000,
}
req = urllib.request.Request(
    'https://api.deepseek.com/chat/completions',
    data=json.dumps(body).encode('utf-8'),      # 必须显式 UTF-8，否则中文乱码
    headers={'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json; charset=utf-8'},
    method='POST')
t = time.time()
with urllib.request.urlopen(req, timeout=900) as r:
    data = json.loads(r.read().decode('utf-8'))
print('（%.1fs / %s tokens）' % (time.time() - t, data.get('usage', {}).get('completion_tokens')))
print((data['choices'][0]['message'].get('content') or '(空回复——多半是 max_tokens 被思维链吃光，把裁切再拆小)').strip())
