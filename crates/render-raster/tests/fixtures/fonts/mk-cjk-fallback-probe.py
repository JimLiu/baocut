#!/usr/bin/env python3
"""Build a CC0 font covering only U+20BB7 for deterministic CJK fallback tests."""
from pathlib import Path

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

LICENSE = "Placed in the public domain under CC0-1.0 by the BaoCut project."


def rectangle():
    pen = TTGlyphPen(None)
    pen.moveTo((50, 0))
    pen.lineTo((650, 0))
    pen.lineTo((650, 700))
    pen.lineTo((50, 700))
    pen.closePath()
    return pen.glyph()


font = FontBuilder(1000, isTTF=True)
font.setupGlyphOrder([".notdef", "rareHan"])
font.setupCharacterMap({0x20BB7: "rareHan"})
font.setupGlyf({name: rectangle() for name in [".notdef", "rareHan"]})
font.setupHorizontalMetrics({name: (750, 50) for name in [".notdef", "rareHan"]})
font.setupHorizontalHeader(ascent=800, descent=-200)
font.setupNameTable({
    "familyName": "Source Han Sans SC",
    "styleName": "Regular",
    "uniqueFontIdentifier": "BaoCut;CjkFallbackProbe",
    "fullName": "BaoCut CJK Fallback Probe",
    "psName": "BaoCut-CjkFallbackProbe",
    "version": "Version 1.000",
    "copyright": LICENSE,
    "licenseDescription": LICENSE,
    "licenseInfoURL": "https://creativecommons.org/publicdomain/zero/1.0/",
})
font.setupOS2(sTypoAscender=800, sTypoDescender=-200, usWinAscent=800, usWinDescent=200)
font.setupPost()
font.save(Path(__file__).with_name("cjk-fallback-probe.ttf"))
