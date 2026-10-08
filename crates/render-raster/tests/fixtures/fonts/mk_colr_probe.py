#!/usr/bin/env python3
"""生成 `ColrProbe.ttf`：一个从零构造的 COLR v0 / CPAL v0 探针字体。

用途：bcut-render 的彩色字形回归测试。它复现 Windows `Segoe UI Emoji` 的结构
特征——基字形 `A` 自带**非空**单色回退轮廓（COLR 规范要求），彩色图形放在
COLR 图层里。据此可以证伪「轮廓无填充面积才走彩色通道」这一判据。

图层刻意做成两块**互不重叠**的斜边图形：
- `colrRed`   菱形，调色板 0 = 不透明纯红 (255, 0, 0, 255)
- `colrBlue`  三角形，调色板 1 = 不透明纯蓝 (0, 0, 255, 255)

斜边保证光栅化时一定出现部分覆盖（AA）像素；互不重叠保证红色区域的像素
通道里 g == b == 0，测试可以据此断言 swash COLR 通道输出**已预乘**
（不透明纯色 + 零初始化目标缓冲 ⇒ r 与 a 逐位相等）。

所有轮廓均为本脚本原创（简单多边形），不派生自任何第三方字体。
生成物以 CC0-1.0 置于公有领域。

用法：
    pip install fonttools
    python3 core/fixtures/fonts/mk_colr_probe.py
"""

from pathlib import Path

from fontTools.colorLib.builder import buildCOLR, buildCPAL
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

UPEM = 1000
LICENSE = "Placed in the public domain under CC0-1.0 by the BaoCut project."


def polygon(points):
    pen = TTGlyphPen(None)
    if not points:
        return pen.glyph()
    pen.moveTo(points[0])
    for point in points[1:]:
        pen.lineTo(point)
    pen.closePath()
    return pen.glyph()


def main():
    out = Path(__file__).resolve().parent / "ColrProbe.ttf"

    glyphs = {
        ".notdef": polygon([(50, 0), (450, 0), (450, 700), (50, 700)]),
        # 基字形：非空单色回退轮廓（覆盖两个图层的并集外框）
        "A": polygon([(50, 0), (950, 0), (950, 700), (50, 700)]),
        # 图层 1：菱形，斜边 ⇒ 必有 AA 像素
        "colrRed": polygon([(275, 150), (475, 350), (275, 550), (75, 350)]),
        # 图层 2：三角形，与菱形的包围盒不相交
        "colrBlue": polygon([(550, 60), (930, 60), (740, 640)]),
        "space": polygon([]),
    }
    order = [".notdef", "space", "A", "colrRed", "colrBlue"]

    fb = FontBuilder(UPEM, isTTF=True)
    fb.setupGlyphOrder(order)
    fb.setupCharacterMap({0x20: "space", 0x41: "A"})
    fb.setupGlyf({name: glyphs[name] for name in order})
    fb.setupHorizontalMetrics({name: (1000, 50) for name in order})
    fb.setupHorizontalHeader(ascent=800, descent=-200)
    fb.setupNameTable(
        {
            "copyright": LICENSE,
            "familyName": "ColrProbe",
            "styleName": "Regular",
            "uniqueFontIdentifier": "BaoCut;ColrProbe-Regular",
            "fullName": "ColrProbe",
            "version": "Version 1.000",
            "psName": "ColrProbe-Regular",
            "licenseDescription": LICENSE,
            "licenseInfoURL": "https://creativecommons.org/publicdomain/zero/1.0/",
        }
    )
    fb.setupOS2(sTypoAscender=800, sTypoDescender=-200, usWinAscent=800, usWinDescent=200)
    fb.setupPost(isFixedPitch=0)

    # COLR v0：基字形 A → [红菱形(调色板 0), 蓝三角(调色板 1)]
    fb.font["COLR"] = buildCOLR({"A": [("colrRed", 0), ("colrBlue", 1)]})
    fb.font["CPAL"] = buildCPAL([[(1.0, 0.0, 0.0, 1.0), (0.0, 0.0, 1.0, 1.0)]])

    fb.save(str(out))
    print(f"wrote {out} ({out.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
