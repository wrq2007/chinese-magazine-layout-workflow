"""Generate a magazine grid template as SVG.

Draws bleed / trim / margin / column guides (and optional baseline grid) for a
single page or a two-page spread. Units are millimetres in the SVG coordinate
system (viewBox), so the file can be placed as a reference layer at 1:1.

Usage:
  python make_grid_svg.py --out grid.svg
  python make_grid_svg.py --width 185 --height 260 --cols 6 --gutter 7 \
      --margins 18,22,20,16 --spread --out spread.svg
  python make_grid_svg.py --baseline 4.938 --out grid-baseline.svg   # 14pt
"""

from __future__ import annotations

import argparse

MM = 1.0  # viewBox unit == 1 mm


def build(
    width: float,
    height: float,
    bleed: float,
    top: float,
    bottom: float,
    inner: float,
    outer: float,
    cols: int,
    gutter: float,
    spread: bool,
    baseline: float | None,
    stroke: float,
) -> str:
    pages = 2 if spread else 1
    total_w = width * pages + 2 * bleed
    total_h = height + 2 * bleed
    parts: list[str] = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{total_w * 4}mm" '
        f'height="{total_h * 4}mm" viewBox="0 0 {total_w} {total_h}">',
        "<style>"
        f".bleed{{fill:none;stroke:#ff00aa;stroke-width:{stroke};stroke-dasharray:2 1.5}}"
        f".trim{{fill:none;stroke:#111;stroke-width:{stroke * 1.6}}}"
        f".margin{{fill:none;stroke:#2b7fff;stroke-width:{stroke}}}"
        f".col{{stroke:#7cc4ff;stroke-width:{stroke * 0.7}}}"
        f".baseline{{stroke:#cfe6ff;stroke-width:{stroke * 0.4}}}"
        f".fold{{stroke:#ff8a00;stroke-width:{stroke};stroke-dasharray:3 1.5}}"
        "</style>",
        f'<rect class="bleed" x="0" y="0" width="{total_w}" height="{total_h}"/>',
    ]

    for p in range(pages):
        x0 = bleed + p * width
        parts.append(f'<rect class="trim" x="{x0}" y="{bleed}" width="{width}" height="{height}"/>')
        top_y = bleed + top
        box_h = height - top - bottom
        # inner margin sits on the fold side; for a single page assume left-binding
        left = inner if p == 0 else outer
        right = outer if p == 0 else inner
        text_x = x0 + left
        text_w = width - left - right
        parts.append(
            f'<rect class="margin" x="{text_x}" y="{top_y}" width="{text_w}" height="{box_h}"/>'
        )

        col_w = (text_w - gutter * (cols - 1)) / cols
        parts.append(f'<g class="col">')
        for c in range(1, cols):
            cx = text_x + c * (col_w + gutter) - gutter / 2
            parts.append(f'<line x1="{cx}" y1="{top_y}" x2="{cx}" y2="{top_y + box_h}"/>')
        parts.append("</g>")

        if baseline and baseline > 0:
            rows = int(box_h // baseline)
            parts.append('<g class="baseline">')
            for r in range(1, rows + 1):
                y = top_y + r * baseline
                parts.append(f'<line x1="{text_x}" y1="{y}" x2="{text_x + text_w}" y2="{y}"/>')
            parts.append("</g>")
            parts.append(
                f'<text x="{text_x}" y="{top_y + box_h + 3}" font-size="3.2" fill="#2b7fff">'
                f"baseline {baseline:.3f}mm · {rows} lines</text>"
            )

    if spread:
        fold_x = bleed + width
        parts.append(f'<line class="fold" x1="{fold_x}" y1="{bleed}" x2="{fold_x}" y2="{bleed + height}"/>')

    parts.append(
        f'<text x="{bleed}" y="{bleed - 1.5}" font-size="3.4" fill="#111">'
        f"{width:g}x{height:g}mm · bleed {bleed:g}mm · {cols} cols · gutter {gutter:g}mm"
        f" · margins T{top:g}/B{bottom:g}/In{inner:g}/Out{outer:g}</text>"
    )
    parts.append("</svg>")
    return "\n".join(parts)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--width", type=float, default=185.0)
    ap.add_argument("--height", type=float, default=260.0)
    ap.add_argument("--bleed", type=float, default=3.0)
    ap.add_argument("--margins", default="18,22,20,16", help="top,bottom,inner,outer in mm")
    ap.add_argument("--cols", type=int, default=6)
    ap.add_argument("--gutter", type=float, default=7.0)
    ap.add_argument("--baseline", type=float, default=None, help="baseline step in mm, e.g. 4.938 for 14pt")
    ap.add_argument("--spread", action="store_true")
    ap.add_argument("--stroke", type=float, default=0.25)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    top, bottom, inner, outer = (float(v) for v in args.margins.split(","))
    svg = build(
        args.width,
        args.height,
        args.bleed,
        top,
        bottom,
        inner,
        outer,
        args.cols,
        args.gutter,
        args.spread,
        args.baseline,
        args.stroke,
    )
    with open(args.out, "w", encoding="utf-8") as fh:
        fh.write(svg)
    print(f"wrote {args.out}")


if __name__ == "__main__":
    main()
