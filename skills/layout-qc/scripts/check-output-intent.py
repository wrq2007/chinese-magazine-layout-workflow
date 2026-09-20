# 印前硬指标：PDF 有没有「输出意图 / 内嵌特性文件」
#
# 为什么要有它（2026-09-20 补的盲区）：
#   导出时写了 pdfDestinationProfile = SWOP，颜色确实按 SWOP 转过了，
#   但 PDF 里**没有嵌 /OutputIntent、也没有 /ICCBased 特性文件、更不是 PDF/X**。
#   结果就是：印厂拿到文件只能靠猜——它按自己的流程再转一次，颜色就不是你定的那个。
#   实测（发刊词 2026-09-20）：/OutputIntent 0 次、/ICCBased 0 次、PDF/X 标识 0 次。
#   而当时所有例行检查都是绿的，因为没人看这一项。
#
# 只看不改。用法：python check-output-intent.py <pdf>
import io
import sys

import fitz

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')


def main():
    pdf = sys.argv[1]
    raw = open(pdf, 'rb').read()
    doc = fitz.open(pdf)

    has_oi = doc.xref_get_key(doc.pdf_catalog(), 'OutputIntent') not in (None, ('null', 'null'))
    n_icc = raw.count(b'/ICCBased')
    n_gts = raw.count(b'GTS_PDFX')
    is_pdfx = n_gts > 0
    has_version = b'pdfx:GTS_PDFXVersion' in raw

    # 页面的颜色来自哪里：有 DeviceCMYK 位图，说明颜色是"设备相关"的
    dev = 0
    for p in doc:
        for im in p.get_images(full=True):
            if doc.extract_image(im[0]).get('colorspace') == 4:
                dev += 1
                break
        else:
            continue
        break

    print('=== 输出意图 / 色彩管理 ===')
    print('  /OutputIntent          : %s' % ('有' if has_oi else '**没有**'))
    print('  /ICCBased 特性文件     : %d 处' % n_icc)
    print('  PDF/X 标识             : %s' % ('有（%d 处 GTS_PDFX）' % n_gts if is_pdfx else '**没有**'))
    print('  PDF/X 版本声明         : %s' % ('有' if has_version else '没有'))
    print('  DeviceCMYK 位图        : %s' % ('有（颜色是设备相关的，必须靠输出意图校准）' if dev else '无'))

    print()
    print('=== 判定 ===')
    if has_oi and n_icc:
        print('  [合格] 已内嵌输出意图与特性文件，印厂可复原你设定的色彩')
        return 0
    print('  [注意] PDF 没有内嵌输出意图/特性文件：')
    if dev:
        print('         位图是 DeviceCMYK，颜色没有"身份证"。印厂只能按自家流程再转一次，')
        print('         你按 SWOP 定的颜色到纸上会变。')
    print('         建议：InDesign 导出时勾选 PDF/X-4（或至少勾「包含输出意图」），')
    print('         或把 SOCO 的 ICC 一并交给印厂，并在交付说明里写明目标配置文件。')
    return 0


if __name__ == '__main__':
    sys.exit(main())