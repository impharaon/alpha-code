"""score_docx.py <report.docx> <pdf-page-count> : 10-element checklist by reopening the file (python-docx + XML)."""
import json, re, sys, zipfile
from docx import Document
from docx.oxml.ns import qn
f = sys.argv[1]; pages = int(sys.argv[2]) if len(sys.argv) > 2 else None
d = Document(f); z = zipfile.ZipFile(f); names = z.namelist()
doc_xml = z.read("word/document.xml").decode("utf-8")
num_xml = z.read("word/numbering.xml").decode("utf-8") if "word/numbering.xml" in names else ""
styles_xml = z.read("word/styles.xml").decode("utf-8") if "word/styles.xml" in names else ""
R = {}
def res(k, status, ev): R[k] = {"status": status, "evidence": ev}
paras = d.paragraphs
# heading level via style name or outline level
def level(p):
    n = (p.style.name or "") if p.style is not None else ""
    m = re.match(r"(?i)heading\s*(\d)", n) or re.match(r"标题\s*(\d)", n)
    if m: return int(m.group(1))
    ol = p._p.find(qn("w:pPr") + "/" + qn("w:outlineLvl"))
    if ol is not None: return int(ol.get(qn("w:val"))) + 1
    # style-level outline
    st = p.style
    while st is not None:
        e = st.element.find(qn("w:pPr") + "/" + qn("w:outlineLvl")) if st.element is not None else None
        if e is not None: return int(e.get(qn("w:val"))) + 1
        st = st.base_style
    return None
lv = {}
for p in paras:
    l = level(p)
    if l and p.text.strip(): lv.setdefault(l, []).append(p.text.strip()[:30])
# 1 cover title
first_h1 = next((i for i, p in enumerate(paras) if level(p) == 1 and p.text.strip()), len(paras))
cover = [p.text.strip() for p in paras[:first_h1] if p.text.strip()]
title_hit = any("2026" in t and "第三季度经营分析" in t.replace(" ", "") for t in cover[:6])
res("01 cover title", "pass" if title_hit else ("partial" if any("经营分析" in t for t in cover) else "fail"), f"text before first H1: {cover[:4]}")
# 2 three heading levels
have = sorted(k for k in lv if k <= 3)
res("02 three heading levels", "pass" if all(k in lv for k in (1, 2, 3)) else ("partial" if len(have) == 2 else "fail"),
    {k: (len(v), v[:2]) for k, v in sorted(lv.items())})
# 3 two tables, one with >=6 data rows
tb = [(len(t.rows), len(t.columns)) for t in d.tables]
big = any(r >= 7 for r, _ in tb)
res("03 two data tables (one 6+ rows)", "pass" if len(tb) >= 2 and big else ("partial" if len(tb) >= 1 else "fail"), f"tables (rows x cols incl. header): {tb}")
# numbering formats
absfmt = {}
for m in re.finditer(r'<w:abstractNum\b[^>]*w:abstractNumId="(\d+)".*?</w:abstractNum>', num_xml, re.S):
    lv0 = re.search(r'<w:lvl\b[^>]*w:ilvl="0".*?<w:numFmt w:val="([^"]+)"', m.group(0), re.S)
    absfmt[m.group(1)] = lv0.group(1) if lv0 else None
numfmt = {}
for m in re.finditer(r'<w:num\b[^>]*w:numId="(\d+)"[^>]*>.*?<w:abstractNumId w:val="(\d+)"', num_xml, re.S):
    numfmt[m.group(1)] = absfmt.get(m.group(2))
# style-linked numbering
style_num = {}
for s in d.styles:
    try:
        e = s.element.find(qn("w:pPr") + "/" + qn("w:numPr") + "/" + qn("w:numId"))
        if e is not None: style_num[s.name] = e.get(qn("w:val"))
    except Exception: pass
bul, numd, literal_bullets, literal_nums = [], [], [], []
for p in paras:
    if level(p): continue
    e = p._p.find(qn("w:pPr") + "/" + qn("w:numPr") + "/" + qn("w:numId"))
    nid = e.get(qn("w:val")) if e is not None else style_num.get(p.style.name if p.style is not None else "")
    t = p.text.strip()
    if nid and nid != "0" and t:
        (bul if numfmt.get(nid) == "bullet" else numd).append((numfmt.get(nid), t[:20]))
    elif re.match(r"^[•·●▪■◆\-–]\s*", t): literal_bullets.append(t[:20])
    elif re.match(r"^(\d+[\.、\)]|[（(]\d+[)）])\s*", t): literal_nums.append(t[:20])
lb = (p.style.name for p in paras)
listbullet_style = [p.text.strip()[:20] for p in paras if p.style is not None and re.search(r"(?i)list bullet", p.style.name or "") and p.text.strip()]
listnum_style = [p.text.strip()[:20] for p in paras if p.style is not None and re.search(r"(?i)list number", p.style.name or "") and p.text.strip()]
res("04 bulleted list", "pass" if bul or listbullet_style else ("partial" if literal_bullets else "fail"),
    f"numbering-bullets={len(bul)} {bul[:2]} | List Bullet style={len(listbullet_style)} | literal glyph bullets={len(literal_bullets)}")
res("05 numbered list", "pass" if numd or listnum_style else ("partial" if literal_nums else "fail"),
    f"numbering-numbered={len(numd)} {numd[:2]} | List Number style={len(listnum_style)} | literal typed numbers={len(literal_nums)} {literal_nums[:2]}")
# 6 chart or image
pics = len(re.findall(r"<pic:pic\b", doc_xml)); charts = len(re.findall(r"<c:chart\b", doc_xml)); media = [n for n in names if n.startswith("word/media/")]
res("06 chart or image", "pass" if pics or charts else "fail", f"pictures={pics} native charts={charts} media={media}")
# 7/8 header, footer page numbers
hdr_txt, ftr_page, ftr_txt = [], False, []
for n in names:
    if re.match(r"word/header\d*\.xml", n):
        x = z.read(n).decode("utf-8"); t = "".join(re.findall(r"<w:t[^>]*>([^<]*)</w:t>", x))
        if t.strip(): hdr_txt.append(t.strip()[:40])
    if re.match(r"word/footer\d*\.xml", n):
        x = z.read(n).decode("utf-8"); ftr_txt.append("".join(re.findall(r"<w:t[^>]*>([^<]*)</w:t>", x)).strip()[:40])
        if re.search(r'instr="\s*PAGE\b|<w:instrText[^>]*>\s*PAGE\b|w:fldSimple[^>]*PAGE', x): ftr_page = True
hdr_ref = len(re.findall(r"<w:headerReference", doc_xml)); ftr_ref = len(re.findall(r"<w:footerReference", doc_xml))
res("07 header", "pass" if hdr_txt and hdr_ref else "fail", f"header text={hdr_txt[:2]} refs={hdr_ref}")
res("08 footer with page numbers", "pass" if ftr_page and ftr_ref else ("partial" if ftr_txt and any(ftr_txt) else "fail"), f"PAGE field={ftr_page} footer text={ftr_txt[:2]} refs={ftr_ref}")
# 9 TOC
toc_field = bool(re.search(r"<w:instrText[^>]*>\s*TOC\b|fldSimple[^>]*instr=\"\s*TOC", doc_xml))
toc_sdt = "Table of Contents" in doc_xml
# Any whitespace between the two characters, including the ideographic space (U+3000) of Chinese typesetting.
toc_title = [p.text.strip() for p in paras if re.sub(r"\s", "", p.text) == "目录"]
toc_entries = [p.text.strip()[:25] for p in paras if p.style is not None and re.match(r"(?i)toc\s*\d", p.style.name or "") and p.text.strip()]
res("09 short table of contents", "pass" if (toc_field or toc_sdt or toc_title) else "fail",
    f"TOC field={toc_field} sdt={toc_sdt} title={toc_title[:1]} cached TOC entries in file={len(toc_entries)} {toc_entries[:3]} (rendered content judged on the page images)")
# 10 page count 5-6
res("10 5-6 pages (LibreOffice)", "pass" if pages in (5, 6) else ("partial" if pages in (4, 7) else "fail"), f"LibreOffice PDF pages={pages}")
# fonts
ea = sorted(set(re.findall(r'w:eastAsia="([^"]+)"', doc_xml + styles_xml)))
R["_fonts_eastAsia"] = ea
n = sum(1 for k, v in R.items() if not k.startswith("_") and v["status"] == "pass")
R["_score"] = n
print(json.dumps(R, ensure_ascii=False, indent=1))
