"""check_xlsx.py <workbook.xlsx> <outdir> : requirement checks for the pilot workbook.
A) structure of the file as produced (openpyxl + zip parts)  B) LibreOffice headless recalculation of a COPY via the
xlsx skill's recalc.py  C) recalculated values vs totals computed independently in Python (shared/sales.json)."""
import datetime as dt, json, os, re, shutil, subprocess, sys, time, zipfile
from pathlib import Path
from openpyxl import load_workbook
P = Path("/Users/pharaon/.cache/alpha-orch/2026-11-25/office-pilot"); F = P / "F-excel"; DP = Path("/Users/pharaon/.cache/alpha-orch/2026-11-26/doc-pilot")
src = Path(sys.argv[1]).resolve(); out = Path(sys.argv[2]); out.mkdir(parents=True, exist_ok=True)
exp = json.load(open(F / "shared/sales.json", encoding="utf-8"))["expected"]
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
R["defined_names"] = {k: v.attr_text for k, v in wb.defined_names.items()}
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

# ---------- B) recalculation of a copy (the file under test is not touched)
copy = out / ("recalc_" + src.name); shutil.copyfile(src, copy); os.chmod(copy, 0o644)
(DP / "score/tmp").mkdir(parents=True, exist_ok=True); env = dict(PATH="/private/tmp/docpilot/bin:/usr/bin:/bin", HOME=str(DP / "score/tmp"), TMPDIR=str(DP / "score/tmp") + "/", PYTHONDONTWRITEBYTECODE="1", LANG="en_US.UTF-8")
t = time.time()
p = subprocess.run([str(F / "venv/bin/python"), "-B", str(P / "E-skills/repo/skills/xlsx/scripts/recalc.py"), str(copy), "120"], capture_output=True, text=True, env=env)
R["recalc_seconds"] = round(time.time() - t, 2); R["recalc_exit"] = p.returncode
try: R["recalc"] = json.loads(p.stdout)
except Exception: R["recalc"] = {"unparsed_stdout": p.stdout[-600:], "stderr": p.stderr[-600:]}

# ---------- C) values after recalculation vs independent totals
v = load_workbook(copy, data_only=True)
def month_key(a):
    if isinstance(a, (dt.datetime, dt.date)): return a.strftime("%Y-%m")
    if isinstance(a, str):
        m = re.match(r"\s*(2025)[-年/](\d{1,2})", a)
        if m: return f"{m[1]}-{int(m[2]):02d}"
    return None
got_region, got_month, growth, uncomputed = {}, {}, {}, 0
for ws in v.worksheets:
    for row in ws.iter_rows(max_col=4):
        a, b = row[0].value, row[1].value
        if isinstance(a, str) and a.strip() in exp["region"] and isinstance(b, (int, float)) and ws.title != v.worksheets[0].title: got_region.setdefault(a.strip(), b)
        k = month_key(a)
        if k and ws.title != v.worksheets[0].title and isinstance(b, (int, float)):
            got_month.setdefault(k, b); growth.setdefault(k, row[2].value)
for ws0, ws1 in zip(load_workbook(copy).worksheets, v.worksheets):
    for row in ws0.iter_rows():
        for c in row:
            if c.data_type == "f" and ws1[c.coordinate].value is None: uncomputed += 1
cmp_r = {k: (got_region.get(k), exp["region"][k], got_region.get(k) is not None and abs(got_region[k] - exp["region"][k]) < 0.01) for k in exp["region"]}
cmp_m = {k: (got_month.get(k), exp["month"][k], got_month.get(k) is not None and abs(got_month[k] - exp["month"][k]) < 0.01) for k in exp["month"]}
exp_growth = {}
ks = sorted(exp["month"])
for a, b in zip(ks, ks[1:]): exp_growth[b] = (exp["month"][b] - exp["month"][a]) / exp["month"][a]
cmp_g = {k: (growth.get(k), round(exp_growth[k], 6), isinstance(growth.get(k), (int, float)) and abs(growth[k] - exp_growth[k]) < 1e-6) for k in exp_growth}
R["values"] = {"region_ok": sum(x[2] for x in cmp_r.values()), "region_n": len(cmp_r), "month_ok": sum(x[2] for x in cmp_m.values()), "month_n": len(cmp_m),
               "growth_ok": sum(x[2] for x in cmp_g.values()), "growth_n": len(cmp_g), "formula_cells_without_value_after_recalc": uncomputed,
               "region": cmp_r, "month": cmp_m, "growth": cmp_g}
json.dump(R, open(out / "check.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1, default=str)
# concise print
print("FILE", src.name, R["bytes"], "bytes")
for name, s in sheets.items():
    print(f" [{name}] dims={s['dims']} formulas={s['formula_cells']} (cached before recalc: {s['formula_cells_with_cached_value']}) numbers={s['number_constants']} text/date={s['text_or_date_cells']} fonts={s['fonts']}")
    print(f"    freeze={s['freeze_panes']} widths={s['col_widths']} cf={s['cond_formats']} dv={s['data_validations']}")
    print(f"    print={s['print']} formats={s['number_formats']}")
    print(f"    sample={s['sample']}")
print(" chartsheets", R["chartsheets"], "| defined names", R["defined_names"]); print(" charts", charts)
print(" RECALC", R["recalc_seconds"], "s exit", R["recalc_exit"], json.dumps(R["recalc"], ensure_ascii=False)[:500])
print(" VALUES region %d/%d month %d/%d growth %d/%d | formula cells still without a value: %d" % (R["values"]["region_ok"], R["values"]["region_n"], R["values"]["month_ok"], R["values"]["month_n"], R["values"]["growth_ok"], R["values"]["growth_n"], uncomputed))
