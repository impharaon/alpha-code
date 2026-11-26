---
name: codepuppy-document-xlsx
description: "Use this skill any time a spreadsheet file is the primary input or output. This means any task where the user wants to: open, read, edit, or fix an existing .xlsx, .xlsm, .xltx, .csv, or .tsv file (e.g., adding columns, computing formulas, formatting, charting, cleaning messy data); create a new spreadsheet from scratch or from other data sources; or convert between tabular file formats. Trigger especially when the user references a spreadsheet file by name or path — even casually (like \"the xlsx in my downloads\") — and wants something done to it or produced from it. Also trigger for cleaning or restructuring messy tabular data files (malformed rows, misplaced headers, junk data) into proper spreadsheets. The deliverable must be a spreadsheet file. Do NOT trigger when the primary deliverable is a Word document, HTML report, standalone Python script, database pipeline, or Google Sheets API integration, even if tabular data is involved."
license: Complete terms in LICENSE.txt
---

> Code Puppy adaptation, 2026-11-26. Derived from Anthropic skills @ e4bb5d960d87126ff3b3a8af1a104b7db67560ba; see LICENSE.txt and ../document-skills.lock.json for source and changes.

Read [the document workflow](../WORKFLOW.md) before making or checking a file.

# XLSX creation, editing, and analysis

| Task | Approach |
|---|---|
| **Create** or **edit** with formulas/formatting | Bundled openpyxl through `OfficeExcel.edit` |
| **Bulk data** in or out | Python `csv` and openpyxl through the same edit context |
| **Read** values, formulas and structure | `OfficeExcel.inspect`, or the existing `read_xlsx` and first-party Excel tools |

Use `from codepuppy_office import OfficeExcel` with the absolute Office Python interpreter. This module is available to scripts without enabling any connector. The connector is another entry point into the same implementation.

## Requirements for every output

- **Chinese typography:** default to bundled Noto Sans SC, set actual cell Font.name, and use suitable widths and wrapped row heights. Preserve user fonts/styles and user templates; otherwise start from the bundled analysis workbook.
- **Check recalculated formula errors and independent totals.** Fix issues in the single correction round. Deliver the file with a truthful list of remaining errors or incomplete recalculation; an error never hides or deletes the generated file.
- **Use formulas, never hardcoded results.** Write `sheet['B10'] = '=SUM(B2:B9)'`, not the Python-computed total. The sheet must recalculate when its inputs change.
- **Follow the user's spec literally.** Exact tab names, exact column headers, and the formula they spelled out. A redesign that computes something else fails, however elegant.
- **Document every assumption and hardcoded number** where the reader will see it — a cell comment, or an adjacent cell at a table's end. Cite a real source when one exists (`Source: Company 10-K, FY2024, Page 45, Revenue Note, [SEC EDGAR URL]`); when the number came from the user, say so plainly.
- **A workbook *you create* for someone to fill in** needs a short legend naming which cells to edit, and one example row of realistic values showing the expected format. Never add such a row to a file you were asked to edit.
- **Editing an existing file: match its conventions exactly.** They override every guideline here. Find its designated input cells first — a distinct font color, fill, or shading marks them — change the cells needed for the request, and preserve unrelated formulas and formatting.

## Editing, objects and recalculation

```python
from codepuppy_office import OfficeExcel

with OfficeExcel.edit(output_path) as workbook:
    sheet = workbook["销售"]
    sheet["B10"] = "=SUM(B2:B9)"
    sheet["B10"].number_format = '#,##0.00'
result = OfficeExcel.recalculate(output_path)
```

Use the module's shared edit/save path for both new and existing workbooks. It preserves slicers, sparklines, pivots and relationships; a later bare openpyxl save can destroy them. It detects changed pivot source ranges and rebuilds supported pivots before saving. Read every `pivot-not-rebuilt` diagnostic and report it as remaining; do not claim all pivots refreshed just because saving succeeded.

For structure, ranges and search use `OfficeExcel.inspect(input_json)`. For sorting/replacement use `OfficeExcel.apply_edit(input_json)`. For pivots, slicers and sparklines, obtain `OfficeExcel.object_schema(operation)` when needed and pass its exact parameters to `OfficeExcel.objects(path, operation, input_json)`. The operations are create/delete pivot table, add/delete slicer, and add/delete sparklines. Describe is optional if the schema is already known. These are also available through `excel_inspect`, `excel_edit`, `excel_objects` and `excel_recalculate` when that connector is used; do not install a community server or a second Excel entry.

Recalculate whenever formulas change. LibreOffice computes a private copy; `OfficeExcel.recalculate` merges formula/chart caches into the original OOXML without replacing it with LibreOffice's whole-file save. Inspect the returned status, formula count, missing results, cell errors and diagnostics. A process exit of zero is not evidence of clean formulas. If runtime preparation is pending, deliver now and state that recalculation and layout checking are unfinished; follow the workflow for the later check.

Read defaults to values; use mode `both` to inspect formulas and values together and follow nextCursor until the requested region is covered. `valueSource=stored` may be stale; `missing` is not a computed blank. A fresh successful result comes from LibreOffice. Formula errors must identify sheet, cell, formula and error. A clean recalculation proves evaluation, not mathematical correctness: independently compute the summary from source data and compare totals, units and all 12 months.

Prefer widely supported formulas such as SUMIFS, INDEX/MATCH, IFERROR and SUMPRODUCT when they satisfy the task. Do not ban a user-requested function; if LibreOffice cannot compute it or results are missing, preserve the formula and report calculation incomplete. Test a few formulas against independent expected values before filling the grid.

## openpyxl gotchas

- **Reading a model takes two loads.** `data_only=True` yields cached values with the formulas gone; the default yields formula strings with no values. One pass cannot give you both.
- **`data_only=True` is destructive if you save.** That workbook has no formulas left, so saving replaces every one with a literal — permanently.
- **`data_only=True` on a file openpyxl just wrote returns `None` everywhere** — use `OfficeExcel.recalculate` first. (A formula whose result is `""` also reads back as `None`.)
- **Merged cells: write the top-left anchor only.** Every other cell in the range is a `MergedCell` whose `.value` is read-only.
- **`.xlsm` loses its macros unless you pass `keep_vba=True`** to `load_workbook`.
- **A sheet name containing a space must be quoted** in a cross-sheet reference: `='Assumptions Inputs'!$B$5`. Unquoted, it evaluates to `#VALUE!`.
- **Bare openpyxl saves can drop extension objects.** Always use the shared `OfficeExcel.edit` context; never save a `data_only=True` workbook over the original.
- **Nothing mends a malformed workbook**: an unclosed quote in a number format (`'0.00 "USD'`), a defined name starting with `=`, or duplicate or empty table headers are saved as written, and Excel may offer to repair the file.
- **Partly bold or italic cell text is flattened** unless `load_workbook(rich_text=True)`; such a `.value` is then a `CellRichText`, not a `str`.
- **Every new formula needs its own `number_format`** (date, %, currency): nothing infers it, so a date shows as `45337` and 30% as `0.3`.
- **On every new chart set `chart.roundedCorners = False`, `.overlay = False` on its legend and on each title you gave it (`chart.legend`, `chart.title`, `chart.x_axis.title`…), and, if it has axes (not pie or doughnut), `chart.x_axis.delete = False` and `chart.y_axis.delete = False`**, or Excel may draw the title or legend over the plot, round the frame, or draw no axes.
- **With a `DateAxis`, set `chart.y_axis.crossAx = 500`**, or Excel may offer to repair the file.

## Financial models

Unless the user says otherwise, or the existing file already does something else.

**Color:** blue text (`0,0,255`) for hardcoded inputs and scenario levers · black for formulas ·
green (`0,128,0`) for links to another sheet · red (`255,0,0`) for links to another file ·
yellow fill (`255,255,0`) for key assumptions and cells the user should fill in.

**Numbers:** currency `$#,##0`, with the unit named in the header (`Revenue ($mm)`) · zeros
render as `-`, including in percentages (`$#,##0;($#,##0);-`) · negatives in parentheses ·
percentages `0.0%`, **stored as fractions** (`0.15` renders `15.0%`; storing `15` renders
`1500.0%`) · valuation multiples `0.0x` · years as text (`"2024"`, never `2,024`).

**Structure:** every assumption in its own labeled cell, referenced by the formulas that use it
(`=B5*(1+$B$6)`, never `=B5*1.05`) · formulas consistent across every projection period, since a
lone edited cell mid-row is the commonest silent error · guard denominators that can be zero.

## Layout and delivery

Include the requested number/date formats, frozen panes, conditional formatting, native charts, dropdown validation and print settings. Respect each sheet's print area, page breaks, repeated headers, orientation and scaling. Use the workflow to render all printable pages, inspect them and record actual issues; do not replace print-layout checking with a grid preview.
