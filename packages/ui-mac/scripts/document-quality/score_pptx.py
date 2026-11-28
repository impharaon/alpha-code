"""score_pptx.py <deck.pptx> : 11-element checklist by reopening with python-pptx. Item 10 (consistent style) is scripted as one slide
master for every slide and at most three font families across all runs; the measurement host also keeps the rendered pages for a
human look, recorded next to the score."""
import json, sys
from pathlib import Path
from pptx import Presentation
from pptx.util import Emu
C = json.load(open(Path(__file__).with_name("content.json"), encoding="utf-8"))
p = Presentation(sys.argv[1]); W = p.slide_width
S = []
def walk(shapes):
    for sh in shapes:
        yield sh
        if sh.shape_type == 6:  # group
            yield from walk(sh.shapes)
for i, sl in enumerate(p.slides, 1):
    info = {"n": i, "text": "", "pics": 0, "tables": 0, "charts": 0, "left_text": 0, "right_text": 0, "shapes": 0, "fonts": set()}
    for sh in walk(sl.shapes):
        info["shapes"] += 1
        if sh.shape_type == 13: info["pics"] += 1
        if getattr(sh, "has_table", False) and sh.has_table: info["tables"] += 1
        if getattr(sh, "has_chart", False) and sh.has_chart: info["charts"] += 1
        if getattr(sh, "has_text_frame", False) and sh.has_text_frame and sh.text_frame.text.strip():
            t = sh.text_frame.text.strip(); info["text"] += t + " | "
            try:
                cx = (sh.left + sh.width / 2) / W
                if len(t) > 6: info["left_text" if cx < 0.5 else "right_text"] += 1
            except Exception: pass
            for para in sh.text_frame.paragraphs:
                for r in para.runs:
                    if r.font.name: info["fonts"].add(r.font.name)
        if getattr(sh, "has_table", False) and sh.has_table:
            info["text"] += " ".join(c.text for row in sh.table.rows for c in row.cells) + " | "
    info["fonts"] = sorted(info["fonts"]); S.append(info)
R = {}
def res(k, st, ev): R[k] = {"status": st, "evidence": ev}
def norm(s): return s.replace(" ", "")
t1 = S[0]["text"] if S else ""
res("01 title slide", "pass" if S and "新产品发布方案" in norm(t1) else "fail", t1[:80])
ag = [s["n"] for s in S if "议程" in s["text"] or "目录" in s["text"] or sum(a[:4] in s["text"] for a in C["P_AGENDA"]) >= 4]
res("02 agenda slide", "pass" if ag else "fail", f"slides={ag}")
ti = [s["n"] for s in S if s["pics"] >= 1 and len(s["text"].replace(" | ", "")) >= 30 and s["n"] not in (1,) and s["charts"] == 0 and s["tables"] == 0]
res("03 text+image slide #1", "pass" if len(ti) >= 1 else "fail", f"slides with picture + >=30 chars text={ti}")
res("04 text+image slide #2", "pass" if len(ti) >= 2 else "fail", f"slides={ti}")
tb = [s["n"] for s in S if s["tables"]]
res("05 table slide", "pass" if tb else "fail", f"native table slides={tb}")
ch = [s["n"] for s in S if s["charts"]]
chimg = [s["n"] for s in S if s["pics"] and ("销量" in s["text"] or "预测" in s["text"]) and not s["charts"]]
res("06 chart slide", "pass" if ch else ("partial" if chimg else "fail"), f"native chart slides={ch}; picture-only chart candidates={chimg}")
cmpk = C["P_COMPARE"]
cp = [s["n"] for s in S if sum(x[:5] in s["text"] for x in cmpk["left"] + cmpk["right"]) >= 6]
cp2 = [s["n"] for s in S if s["n"] in cp and (s["left_text"] >= 1 and s["right_text"] >= 1 or s["tables"])]
res("07 two-column comparison slide", "pass" if cp2 else ("partial" if cp else "fail"), f"comparison content on slides={cp}; left/right text blocks on={cp2}")
tl = [s["n"] for s in S if sum(m[1][:4] in s["text"] for m in C["P_TIMELINE"]) >= 4]
res("08 timeline slide", "pass" if tl else "fail", f"slides with >=4 milestones={tl}")
last = S[-1]["text"] if S else ""
res("09 closing slide", "pass" if any(x[:4] in last for x in C["P_CLOSING"][:2]) else "fail", last[:80])
fonts = sorted(set(f for s in S for f in s["fonts"]))
masters = sorted({sl.slide_layout.slide_master.part.partname for sl in p.slides})
res("10 consistent theme", "pass" if len(masters) == 1 and len(fonts) <= 3 else "fail", f"slide masters={masters}; fonts used across deck={fonts}; layouts per slide={[sl.slide_layout.name for sl in p.slides]}")
res("11 exactly ten slides", "pass" if len(S) == 10 else "fail", f"slides={len(S)}")
R["_score"] = sum(1 for k, v in R.items() if not k.startswith("_") and v["status"] == "pass")
R["_slides"] = [{k: (v if k != "text" else v[:90]) for k, v in s.items()} for s in S]
print(json.dumps(R, ensure_ascii=False, indent=1))
