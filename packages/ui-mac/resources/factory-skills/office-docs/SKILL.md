---
name: office-docs
description: Create, edit, and visually check Word, Excel, PowerPoint, PDF, offline HTML and posters with the bundled document skills. Read existing Office files and operate spreadsheets locally.
license: Apache-2.0 (Code Puppy original routing; adapted source skills retain their own licences)
---

# Local document production

Produce the requested file locally using the bundled environment and the matching skill below. Creation and editing do not require enabling an MCP connector or installing Python, Node, LibreOffice, fonts or packages. Use the existing shell and file permission flow; do not add a separate confirmation to run local code. Cloud Word/Excel/PowerPoint generation (`office-report`) is retired. Do not dispatch it.

| Output | Load this skill |
| --- | --- |
| Word `.docx` | `codepuppy-document-docx` |
| Excel `.xlsx` | `codepuppy-document-xlsx` |
| PowerPoint `.pptx` | `codepuppy-document-pptx` |
| PDF | `codepuppy-document-pdf` |
| Offline HTML page | `codepuppy-document-frontend-design` |
| Poster or other designed image | `codepuppy-document-canvas-design` |
| Theme across these outputs | `codepuppy-document-theme-factory` alongside the format skill |

## Prepare and author

1. Call `codepuppy_document` with `action: "environment"`. Use its absolute `python`, `node`, `nodeModules`, `templates`, `fonts` and `workRoot` paths. Python's host projection is injected by the application; do not construct it. Load npm libraries by absolute `nodeModules` path; no runtime package installation or second Node.
2. Follow the format skill. New Word uses bundled docx; slides use pptxgenjs; Excel uses openpyxl and the shared `OfficeExcel` module described by its format skill; PDF uses reportlab/pypdf. For HTML and posters keep an editable local HTML/CSS/JS source, embed assets and fonts for offline delivery, and export with the built-in Chromium through the document tool.
3. User templates and reference files take priority: edit the existing container and preserve its styles, masters, themes and relationships. Otherwise use the bundled Chinese report/workbook/presentation template from `templates`; adjust it to the request. Do not rebuild a user template as merely similar colours. Do not require a missing style preference to begin.
4. Write the final file at the user's requested project path. Keep scripts, page PNGs and other intermediates under `workRoot`. Write to a sibling temporary file and atomically replace the destination; compare the source SHA-256 before editing an existing file so concurrent user changes are preserved.

## Render, inspect and deliver

- Render with `codepuppy_document` (`action: "render"`, request kind `docx|xlsx|pptx|pdf|html|design`, absolute source path; design also supplies its final PNG `outputPath`). Use the returned receipt and its page paths, not an assumed screenshot or a text extraction.
- Read every rendered page at useful size. When the active model cannot see images, use the existing vision tool on paths already read and ask about missing Chinese characters, overlap, overflow, page breaks and chart labels. Read crops for dense details. Reuse its existing cache, authorization, refusal and billing rules. Use only this visual path; no new service or model fallback.
- Record `action: "check"` with the actual `checkId`, `renderId`, `revision`, coverage, observations, fixes and remaining issues. Account for every page as inspected or uninspected with a reason. Use `final: false` if a correction is needed; otherwise finish with `final: true`.
- Combine necessary fixes into **at most one correction round**. Keep the same checkId, render revision 1 and Read every corrected page before the final report. If that round leaves a problem, deliver the file and state the remaining problem. Do not rewrite a clean document just to use a correction round.
- A `pending` Office render means the file already exists: deliver it now and explicitly say its layout is unchecked (and Excel recalculation too if pending). The application queues a follow-up in this same Session when LibreOffice is ready. On follow-up, inspect the CURRENT file, state which version was checked, preserve concurrent edits, and report a missing file honestly. Work resumes after reopening the application; it does not continue while the app is closed.
- Visual/runtime failure is partial coverage, not a pass. Keep the existing artifact available and state what was not inspected and why. In the final reply briefly give coverage, actual fixes and remaining issues; keep the technical report local.

## Reading and spreadsheet operations

The separate community Excel connector is retired and is not an install option.

The optional first-party stdio connectors retain `read_docx`, `read_pptx`, `read_pdf`, and `read_xlsx`; they are readers, not the production path. Excel additionally offers `excel_inspect`, `excel_edit`, `excel_objects` and `excel_recalculate`. Their default-disabled state does not limit script authoring: the same `OfficeExcel.inspect`, `apply_edit`, `object_schema`, `objects`, `edit` and `recalculate(path)` functions are available to skills. Use the typed operation schemas; pivot/slicer/sparkline operations, sorting and literal replacement share the preserving save layer, which refreshes rebuildable pivots after source edits and reports objects it cannot rebuild. Report actual recalculation errors with sheet/cell/formula/value and bind formulaCheck to its real recalculation receipt.

For file extraction, an already available matching reader can be used; if a connector is absent, use the bundled libraries. Do not ask the user to enable a connector just to create a file, recommend a retired community Office server, upload private documents for formatting, or claim unperformed validation. Preserve the bundled source licences and exclusions.
