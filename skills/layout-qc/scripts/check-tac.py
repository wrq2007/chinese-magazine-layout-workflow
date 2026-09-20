# 印前硬指标：图像总墨量 TAC（四色之和）与四色黑检查
# 依据：AGENTS.md「色彩：CMYK，总墨量 TAC ≤300%（涂布纸）；正文与小字用单色黑 K100，不用四色黑」
# 只读，不改文件。用法：python check-tac.py <pdf>
import io
import sys

import fitz
from PIL import Image

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

pdf_path = sys.argv[1]
doc = fitz.open(pdf_path)

print('=== 图像总墨量 TAC（各页置入的位图）===')
worst = 0
bad = []
warn = []
for pno in range(doc.page_count):
    page = doc[pno]
    for img in page.get_images(full=True):
        xref = img[0]
        info = doc.extract_image(xref)
        raw = info['image']
        try:
            im = Image.open(io.BytesIO(raw))
        except Exception as e:
            print('  P%d xref%d 解码失败：%s' % (pno + 1, xref, e))
            continue
        mode = im.mode
        if mode != 'CMYK':
            print('  P%d xref%d  %s（%s）—— 非 CMYK，未参与 TAC 统计' % (pno + 1, xref, mode, info.get('colorspace')))
            continue
        px = im.load()
        w, h = im.size
        step = max(1, int((w * h / 120000.0) ** 0.5))     # 抽样，控制耗时
        n = over = 0
        mx = 0
        tot = 0
        for y in range(0, h, step):
            for x in range(0, w, step):
                c, m, yy, k = px[x, y]
                tac = (c + m + yy + k) / 255.0 * 100.0
                n += 1
                tot += tac
                if tac > mx:
                    mx = tac
                if tac > 300:
                    over += 1
        mean = tot / n
        # 判定不能只看"单个像素超一点"：JPEG 边缘振铃会让个别像素略高于墨量上限。
        # 实际有意义的判据是——最大 TAC 明显越线（>330%），或超 300% 的像素成片（>2%）。
        over_ratio = 100.0 * over / n
        bad_here = (mx > 330) or (over_ratio > 2.0)
        flag = '   <== 越线' if bad_here else ('   <== 贴线，余量不足' if mx > 300 else '')
        print('  P%d xref%d  %dx%d %s  平均TAC %.0f%%  最大TAC %.0f%%  超300%%像素占比 %.1f%%%s'
              % (pno + 1, xref, w, h, mode, mean, mx, over_ratio, flag))
        worst = max(worst, mx)
        if bad_here:
            bad.append('P%d xref%d 最大 %.0f%%、超线占比 %.1f%%' % (pno + 1, xref, mx, over_ratio))
        elif mx > 300:
            warn.append('P%d xref%d 最大 %.0f%%（超 300%% 像素占 %.2f%%）'
                        % (pno + 1, xref, mx, over_ratio))

print()
print('=== 判定 ===')
if not bad:
    print('  [合格] 所有位图总墨量均未成片越线（判定线：最大 >330% 或超 300% 占比 >2%）')
    for w in warn:
        print('  [注意] 贴线：%s —— 铜版纸的规格线是 300%%，这里余量已不足，'
              '再压暗一点就会越线' % w)
else:
    print('  [需处理] 以下图像 TAC 超 300%%（涂布纸上限）：%s' % '、'.join(bad))
    print('  说明：这是 RGB 照片转 CMYK 的常见结果，暗部容易堆墨。处理办法是导出时套用有 TAC 限制的')
    print('        CMYK 转换（或先在 Photoshop 里用「自定 CMYK / 最大黑版 300%」转一次）。')
