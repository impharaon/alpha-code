"""check_xlsx.py <workbook.xlsx> <recalculated.xlsx> <recalc-receipt.json> <outdir> : requirement checks for the pilot workbook.
A) structure of the file as produced (openpyxl + zip parts)  B) the product's OfficeExcel.recalculate receipt for a COPY
(run by the measurement host; this script never starts LibreOffice)  C) recalculated values vs totals computed
independently in Python (sales.json next to this script)  D) one verdict per requirement of the task (12 items)."""
import datetime as dt, json, re, sys, zipfile
from pathlib import Path
from openpyxl import load_workbook
from openpyxl.utils.cell import range_boundaries
src = Path(sys.argv[1]).resolve(); recalculated = Path(sys.argv[2]).resolve(); receipt = json.loads(Path(sys.argv[3]).read_text(encoding="utf-8"))
out = Path(sys.argv[4]); out.mkdir(parents=True, exist_ok=True)
exp = json.load(open(Path(__file__).with_name("sales.json"), encoding="utf-8"))["expected"]
R = {"file": str(src), "bytes": src.stat().st_size}

# ---------- A) structure
wb = load_workbook(src); wbv = load_workbook(src, data_only=True)
sheets = {}
for ws in wb.worksheets:
    f = n = t = cached = 0; fonts = set(); fmts = {}
    for row in ws.iter_rows():
        for c in row:
            if c.value is None: continue
            if c.data_type == "f" or (isinstance(c.value, str) and c.value.startswith("=")):
                f += 1; cached += wbv[ws.title][c.coordinate].value is not None
            elif isinstance(c.value, (int, float)): n += 1
            else: t += 1
            fonts.add(c.font.name); fmts[c.number_format] = fmts.get(c.number_format, 0) + 1
    ps = ws.page_setup
    sheets[ws.title] = {
        "dims": ws.dimensions, "formula_cells": f, "formula_cells_with_cached_value": cached, "number_constants": n, "text_or_date_cells": t,
        "fonts": sorted(x for x in fonts if x), "number_formats": fmts, "freeze_panes": ws.freeze_panes,
        "col_widths": {k: round(v.width, 1) for k, v in sorted(ws.column_dimensions.items()) if v.width},
        "cond_formats": [{"range": str(cf.sqref), "rules": [r.type + (":" + (r.operator or "") if r.operator else "") for r in cf.rules]} for cf in ws.conditional_formatting],
        "data_validations": [{"sqref": str(d.sqref), "type": d.type, "formula1": d.formula1} for d in (ws.data_validations.dataValidation if ws.data_validations else [])],
        "print": {"orientation": ps.orientation, "fitToWidth": ps.fitToWidth, "fitToHeight": ps.fitToHeight,
                  "fitToPage": bool(ws.sheet_properties.pageSetUpPr and ws.sheet_properties.pageSetUpPr.fitToPage), "title_rows": ws.print_title_rows, "paper": ps.paperSize},
        "charts_seen_by_openpyxl": len(getattr(ws, "_charts", [])),
        "sample": {a: (repr(ws[a].value)[:70], ws[a].number_format) for a in ("A2", "E2", "F2", "B2", "C2", "C10") if ws[a].value is not None},
    }
R["sheets"] = sheets
R["chartsheets"] = [cs.title for cs in wb.chartsheets]
names = {k: v.attr_text for k, v in wb.defined_names.items()}
for ws in wb.worksheets: names.update({f"{ws.title}!{k}": v.attr_text for k, v in ws.defined_names.items()})
R["defined_names"] = names
charts = []
with zipfile.ZipFile(src) as z:
    for name in z.namelist():
        if re.match(r"xl/charts/chart\d+\.xml$", name):
            x = z.read(name).decode("utf-8", "replace")
            kinds = sorted(set(re.findall(r"<(?:\w+:)?(\w+Chart)\b", x)))
            title = re.search(r"<(?:\w+:)?title>.*?</(?:\w+:)?title>", x, re.S)
            charts.append({"part": name, "kinds": kinds, "title": "".join(re.findall(r"<a:t>([^<]*)</a:t>", title.group(0))) if title else None,
                           "series": len(re.findall(r"<(?:\w+:)?ser>", x)), "refs": sorted(set(re.findall(r"<(?:\w+:)?f>([^<]*)</(?:\w+:)?f>", x)))[:6],
                           "roundedCorners0": bool(re.search(r'roundedCorners val="0"', x)), "axis_delete0": len(re.findall(r'<(?:\w+:)?delete val="0"', x))})
R["charts"] = charts

# ---------- B) the product recalculation receipt (OfficeExcel.recalculate on a copy; the file under test is not touched)
R["recalc"] = receipt
recalc_ok = receipt.get("status") == "recalculated"
R["formula_errors"] = len(receipt.get("errors") or []) if recalc_ok else None

# ---------- C) values after recalculation vs independent totals
v = load_workbook(recalculated, data_only=True); formulas = load_workbook(recalculated)
def month_key(a):
    if isinstance(a, (dt.datetime, dt.date)): return a.strftime("%Y-%m")
    if isinstance(a, str):
        m = re.match(r"\s*(2025)[-年/](\d{1,2})", a)
        if m: return f"{m[1]}-{int(m[2]):02d}"
        m = re.match(r"\s*(\d{1,2})\s*月\s*$", a)
        if m: return f"2025-{int(m[1]):02d}"
    return None
ks = sorted(exp["month"]); exp_growth = {b: (exp["month"][b] - exp["month"][a]) / exp["month"][a] for a, b in zip(ks, ks[1:])}
same_row_product = re.compile(r"\$?[A-Z]{1,3}\$?(\d+)\s*\*\s*\$?[A-Z]{1,3}\$?\1(?!\d)")
amount_rows = {ws.title: sum(1 for row in ws.iter_rows() if any(c.data_type == "f" and same_row_product.search(str(c.value)) for c in row)) for ws in wb.worksheets}
detail = max(amount_rows, key=amount_rows.get) if amount_rows and max(amount_rows.values()) else None
detail_title = detail or v.worksheets[0].title
# A summary row is a row (outside the first/detail sheet) whose leading cells name a region or a month; any numeric cell in that
# row may carry the total or the growth rate, so the check does not depend on the column order the model chose.
got_region, got_month, got_growth = {}, {}, {}
for ws in v.worksheets:
    if ws.title == detail_title: continue
    for row in ws.iter_rows():
        lead = [c.value for c in row[:3]]
        region = next((x.strip() for x in lead if isinstance(x, str) and x.strip() in exp["region"]), None)
        month = next((month_key(x) for x in lead if month_key(x)), None)
        numbers = [(c.coordinate, c.value) for c in row if isinstance(c.value, (int, float)) and not isinstance(c.value, bool)]
        if region and region not in got_region:
            hit = next(((a, x) for a, x in numbers if abs(x - exp["region"][region]) < 0.01), None)
            if hit: got_region[region] = (ws.title, *hit)
        if month in exp["month"] and month not in got_month:
            hit = next(((a, x) for a, x in numbers if abs(x - exp["month"][month]) < 0.01), None)
            if hit: got_month[month] = (ws.title, *hit)
        if month in exp_growth and month not in got_growth:
            hit = next(((a, x) for a, x in numbers if abs(x - exp_growth[month]) < 1e-6), None)
            if hit: got_growth[month] = (ws.title, *hit)
uncomputed = 0
for ws0, ws1 in zip(formulas.worksheets, v.worksheets):
    for row in ws0.iter_rows():
        for c in row:
            if c.data_type == "f" and ws1[c.coordinate].value is None: uncomputed += 1
is_formula = lambda hit: hit is not None and formulas[hit[0]][hit[1]].data_type == "f"
formula_text = lambda hit: str(formulas[hit[0]][hit[1]].value)
R["values"] = {"region_ok": len(got_region), "region_n": len(exp["region"]), "month_ok": len(got_month), "month_n": len(exp["month"]),
               "growth_ok": len(got_growth), "growth_n": len(exp_growth), "formula_cells_without_value_after_recalc": uncomputed,
               "region": got_region, "month": got_month, "growth": got_growth}
summary_match = recalc_ok and len(got_region) == len(exp["region"]) and len(got_month) == len(exp["month"]) and len(got_growth) == len(exp_growth)
R["summary_match"] = summary_match

# ---------- D) one verdict per task requirement
D = {}
user_names = [k for k in names if not k.split("!")[-1].startswith("_xlnm")]
def res(k, status, ev): D[k] = {"status": status, "evidence": ev}
res("01 detail table ~200 rows, amount = qty x price formula", "pass" if detail and amount_rows[detail] >= 190 else "fail", f"rows with a same-row product formula per sheet: {amount_rows}")
region_formulas = {k: formula_text(h) for k, h in got_region.items()}
res("02 region totals by formula from the detail sheet", "pass" if len(got_region) == len(exp["region"]) and all(is_formula(h) and ("!" in formula_text(h) or "[" in formula_text(h) or any(n.split("!")[-1] in formula_text(h) for n in user_names)) for h in got_region.values()) else "fail",
    f"matched {len(got_region)}/{len(exp['region'])} after recalc; formulas {list(region_formulas.values())[:2]}")
res("03 monthly totals", "pass" if len(got_month) == len(exp["month"]) else "fail", f"matched {len(got_month)}/{len(exp['month'])} after recalc")
res("04 month-over-month growth by formula", "pass" if len(got_growth) == len(exp_growth) and all(is_formula(h) for h in got_growth.values()) else "fail",
    f"matched {len(got_growth)}/{len(exp_growth)} after recalc; formula cells {sum(is_formula(h) for h in got_growth.values())}")
all_formats = [f for s in sheets.values() for f in s["number_formats"]]
kinds = {"currency": any(re.search(r"[¥￥$]|\[\$|CNY", f) for f in all_formats), "percent": any("%" in f for f in all_formats), "thousands": any("#,##" in f for f in all_formats)}
res("05 number formats: currency, percent, thousands", "pass" if all(kinds.values()) else ("partial" if any(kinds.values()) else "fail"), kinds)
freeze = sheets[detail]["freeze_panes"] if detail else None
res("06 frozen header row", "pass" if freeze and int(re.sub(r"\D", "", freeze) or 0) >= 2 else "fail", f"detail sheet {detail!r} freeze_panes={freeze}")
def display(text): return sum(2 if "⺀" <= ch <= "￯" else 1 for ch in text)
# Chinese text is cut off only where it cannot spill into an empty right neighbour: a single (unmerged, unwrapped) cell whose next
# cell holds a value. Such a cell needs a column width (in '0'-character units, ~1 per Latin and ~2 per CJK character) of at
# least 0.9 x its display width; titles, merged headers and notes that spill or wrap are not judged.
narrow = []
for ws in wb.worksheets:
    widths = sheets[ws.title]["col_widths"]
    merged = list(ws.merged_cells.ranges)
    for row in ws.iter_rows():
        for c in row:
            if not (isinstance(c.value, str) and not c.value.startswith("=") and re.search(r"[一-鿿]", c.value)): continue
            if c.alignment.wrap_text or any(c.coordinate in r for r in merged): continue
            if ws.cell(row=c.row, column=c.column + 1).value is None: continue
            have = widths.get(c.column_letter) or 8.43
            if have < 0.9 * display(c.value): narrow.append(f"{ws.title}!{c.coordinate} {c.value[:12]!r} needs~{display(c.value)} has {have}")
res("07 column widths fit Chinese text", "pass" if not narrow else "fail", narrow[:6] or "no Chinese text cell is cut off by a too-narrow column")
growth_cells = {(h[0], h[1]) for h in got_growth.values()}
def covers(sqref, sheet, address):
    for part in sqref.split():
        c1, r1, c2, r2 = range_boundaries(part); cell = formulas[sheet][address]
        if c1 <= cell.column <= c2 and r1 <= cell.row <= r2: return True
    return False
cf_on_growth = [s["cond_formats"] for t, s in sheets.items() if any(covers(cf["range"], t, a) for cf in s["cond_formats"] for (st, a) in growth_cells if st == t)]
res("08 conditional format on the growth column", "pass" if cf_on_growth else ("partial" if any(s["cond_formats"] for s in sheets.values()) else "fail"), cf_on_growth[:1] or [{t: s["cond_formats"]} for t, s in sheets.items() if s["cond_formats"]][:2])
cjk = lambda s: bool(s and re.search(r"[一-鿿]", s))
bar = [c for c in charts if "barChart" in c["kinds"] and cjk(c["title"])]; line = [c for c in charts if "lineChart" in c["kinds"] and cjk(c["title"])]
res("09 a column chart and a line chart with Chinese titles", "pass" if bar and line else "fail", [(c["kinds"], c["title"]) for c in charts])
lists = [(t, d["sqref"]) for t, s in sheets.items() for d in s["data_validations"] if d["type"] == "list"]
res("10 dropdown (list data validation)", "pass" if lists else "fail", lists[:3])
res("11 a defined name", "pass" if user_names else "fail", user_names[:4])
printed = [t for t, s in sheets.items() if s["print"]["orientation"] == "landscape" and s["print"]["fitToPage"] and s["print"]["fitToWidth"] == 1 and s["print"]["title_rows"]]
res("12 print: landscape, fit to one page wide, repeat header rows", "pass" if printed else "fail", printed or {t: s["print"] for t, s in sheets.items()})
R["checklist"] = D
R["_score"] = sum(1 for x in D.values() if x["status"] == "pass")
json.dump(R, open(out / "check.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1, default=str)
# concise print
print("FILE", src.name, R["bytes"], "bytes")
for name, s in sheets.items():
    print(f" [{name}] dims={s['dims']} formulas={s['formula_cells']} (cached before recalc: {s['formula_cells_with_cached_value']}) numbers={s['number_constants']} text/date={s['text_or_date_cells']} fonts={s['fonts']}")
    print(f"    freeze={s['freeze_panes']} widths={s['col_widths']} cf={s['cond_formats']} dv={s['data_validations']}")
    print(f"    print={s['print']} formats={s['number_formats']}")
print(" chartsheets", R["chartsheets"], "| defined names", R["defined_names"]); print(" charts", charts)
print(" RECALC", receipt.get("status"), "formulas", receipt.get("formulaCount"), "errors", R["formula_errors"], json.dumps(receipt.get("errors") or receipt.get("detail"), ensure_ascii=False)[:300])
print(" VALUES region %d/%d month %d/%d growth %d/%d | formula cells still without a value: %d" % (R["values"]["region_ok"], R["values"]["region_n"], R["values"]["month_ok"], R["values"]["month_n"], R["values"]["growth_ok"], R["values"]["growth_n"], uncomputed))
for k, x in D.items(): print(f" {k:62s} {x['status']:8s} {str(x['evidence'])[:150]}")
print(" score", R["_score"], "/ 12 | formula errors", R["formula_errors"], "| summary match", summary_match)
