"""AC-08 font check, run with the bundled Office Python (-I -B).

make <docx>                        a Word file whose three paragraphs ask for 宋体, 黑体 and 微软雅黑
check <pdf> <assets-dir>           per paragraph of that file: the Chinese fonts PDFium reports for each
                                   character in the rendered PDF, and whether the font each character was
                                   drawn with has a glyph for it (the bundled font file's cmap; a font we
                                   have no file for cannot be verified and is listed as unverified).
Prints one JSON object; exit 0 only when every paragraph is found in the PDF text, uses exactly one
Chinese font, and every character is in the cmap of the bundled font it was drawn with.
"""
import ctypes
import json
import sys
from pathlib import Path

PARAGRAPHS = [
    ("宋体", "宋体段落：第三季度营业收入四点八六亿元，环比增长百分之十二点六；毛利率提升至四十一点八。"),
    ("黑体", "黑体段落：供应链风险需持续跟踪，关键芯片交期仍在十四周以上，建议提高安全库存。"),
    ("微软雅黑", "微软雅黑段落：云服务新增三个区域节点后，华东地区平均访问延迟下降百分之三十一。"),
]


def cjk(char):
    return "㐀" <= char <= "鿿" or "豈" <= char <= "﫿"


def make(path):
    from docx import Document
    from docx.oxml.ns import qn

    document = Document()
    for font, text in PARAGRAPHS:
        run = document.add_paragraph().add_run(text)
        run.font.name = font
        run._element.get_or_add_rPr().get_or_add_rFonts().set(qn("w:eastAsia"), font)
    document.save(path)


def check(pdf, assets):
    import pypdfium2
    import pypdfium2.raw as raw
    from reportlab.pdfbase.ttfonts import TTFontFile

    manifest = json.loads((Path(assets) / "assets.json").read_text(encoding="utf-8"))
    bundled = {}
    for font in manifest["fonts"]:
        bundled[Path(font["path"]).stem.replace("-", "")] = set(TTFontFile(str(Path(assets) / font["path"])).charToGlyph)
    drawn = []
    document = pypdfium2.PdfDocument(pdf)
    try:
        for page in document:
            text = page.get_textpage()
            buffer = ctypes.create_string_buffer(512)
            flags = ctypes.c_int()
            x, y = ctypes.c_double(), ctypes.c_double()
            glyphs = []
            for index in range(text.count_chars()):
                char = chr(raw.FPDFText_GetUnicode(text, index))
                if char.isspace():
                    continue
                size = raw.FPDFText_GetFontInfo(text, index, buffer, len(buffer), ctypes.byref(flags))
                raw.FPDFText_GetCharOrigin(text, index, ctypes.byref(x), ctypes.byref(y))
                glyphs.append((y.value, x.value, char, buffer.raw[: max(size - 1, 0)].decode("utf-8", "replace").split("+", 1)[-1]))
            # Fallback-font glyphs are drawn as separate runs, so text order is not reading order: lines by baseline, then x.
            lines = []
            for glyph in sorted(glyphs, key=lambda item: -item[0]):
                if lines and abs(lines[-1][0][0] - glyph[0]) <= 3:
                    lines[-1].append(glyph)
                else:
                    lines.append([glyph])
            drawn += [(char, font) for line in lines for _, _, char, font in sorted(line, key=lambda item: item[1])]
            text.close()
            page.close()
    finally:
        document.close()
    sequence = "".join(char for char, _ in drawn)
    paragraphs = []
    for requested, source in PARAGRAPHS:
        start = sequence.find(source)
        if start < 0:
            paragraphs.append({"requested": requested, "found": False, "fonts": sorted({font for _, font in drawn})})
            continue
        used = drawn[start : start + len(source)]
        # A glyph can only be verified in a font whose file we have; any other font is reported as unverified.
        paragraphs.append({
            "requested": requested,
            "found": True,
            "fonts": sorted({font for char, font in used if cjk(char)}),
            "unverifiedFonts": sorted({font for _, font in used if font.replace("-", "") not in bundled}),
            "missingGlyphs": sorted({char for char, font in used if font.replace("-", "") in bundled and ord(char) not in bundled[font.replace("-", "")]}),
        })
    passed = all(item["found"] and len(item["fonts"]) == 1 and not item["unverifiedFonts"] and not item["missingGlyphs"] for item in paragraphs)
    print(json.dumps({"passed": passed, "paragraphs": paragraphs}, ensure_ascii=False))
    return passed


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    if sys.argv[1:2] == ["make"] and len(sys.argv) == 3:
        make(sys.argv[2])
    elif sys.argv[1:2] == ["check"] and len(sys.argv) == 4:
        sys.exit(0 if check(sys.argv[2], sys.argv[3]) else 1)
    else:
        sys.exit("usage: document-font-check.py make <docx> | check <pdf> <assets-dir>")
