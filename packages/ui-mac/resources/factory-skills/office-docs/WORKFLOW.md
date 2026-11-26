# Code Puppy document workflow

Application-authored adaptation, 2026-11-26. This is the shared execution guidance for the seven adjacent Anthropic-derived skills; their fixed sources and modifications are recorded in [document-skills.lock.json](document-skills.lock.json). Each skill retains its own LICENSE.txt. This guide does not change filesystem permissions or execute anything by itself.

## Environment and files

Call `codepuppy_document` with `{ "action": "environment" }`. Use its returned absolute `python`, `node`, `nodeModules`, `skills`, `templates`, `fonts` and `workRoot`; never guess a developer-machine path or require the user to install a dependency. Run scripts through the existing shell tool and its workspace permissions. Office Python uses `-I -B`; Node uses a local CommonJS `.cjs` script and absolute package paths:

```js
const path = require("node:path")
const docx = require(path.join(process.argv[2], "docx"))
// Invoke with the returned node executable and nodeModules as argv[2].
```

For PPT use the same pattern for `pptxgenjs`. Do not rely on NODE_PATH, global npm modules, npx, package installation, external converter commands or an online font service. The Python Office libraries and `codepuppy_office.OfficeExcel` are in this interpreter's own site-packages.

Use a supplied template/sample first, otherwise the bundled Chinese template of the requested Office kind. Preserve actual styles, sections, masters, themes and relationships. Record the template path/hash in the selected-template provenance used by the document tooling; do not claim bundled provenance for an unknown source. The tool's actual receipt is authoritative.

Write editable source and final deliverables to the user's project destination. Put generation/intermediate files under the authorized `workRoot`. Publish a generated file through a temporary sibling and atomic replacement; compare source hashes before editing an existing file so concurrent user changes are never overwritten. Do not delete a deliverable because its checks failed.

## Render, inspect, correct once

1. Generate the file using the format skill. Call `codepuppy_document` with action `render` and request `{kind,path}`; use `outputPath` for the complete PNG of kind `design`. Paths are absolute within the authorized workspace. First render omits checkId and defaults to revision 0. Keep the returned checkId and receipt id.
2. Office rendering is LibreOffice PDF → PDFium pages; PDF is direct PDFium. HTML/design use the built-in isolated Chromium, including all vertical segments or the entire declared canvas. Do not substitute the user's Office preview, a browser toolbar screenshot or only the first page. Inspect renderer diagnostics and formula results as well as the images.
3. Read every returned page path, in batches if needed. Use native images when the model accepts them. Otherwise use the existing Read/cloud vision path and the already registered cloud-vision tool to ask about Chinese missing glyphs, overlap, clipping, pagination and chart labels. Failed vision or a page not read remains uninspected; extracted text and thumbnails do not prove visual inspection. No second upload service or model switch is introduced.
4. Submit action `check` with the actual `checkId`, `renderId`, revision, final, inspectedPages, uninspected `{page,reason}`, observations `{page,detail}`, fixes and remaining `{page,detail}`. Account for every page without overlaps between inspected/uninspected. If a correction is needed, record original observations with final=false, fix the issues together once, then render the same checkId at revision=1 and inspect all returned pages again. Re-rendering does not start another correction round. Submit the final report with final=true. For Excel include the actual recalculationId/errors in formulaCheck when available; never invent successful computation.
5. Deliver the file and briefly state what was checked, what was fixed and any remaining issue or unchecked page. If there was nothing to fix, do not rewrite for its own sake. If one correction did not solve it, explain the remainder without automatically starting another round. A failed, partial or timed-out check does not block delivery.

## Runtime preparing and later recheck

An environment query starts background LibreOffice preparation without delaying generation. If render returns pending for Word/Excel/PPT, deliver the already-created file and say “版面尚未检查”; also state unfinished formula recalculation for Excel. The host persists a deferred check and queues its fixed instruction in the original session when ready. On that notification, reread the current file and check that version; compare hashes again before a correction. Do not make the user repeat the request, invent a poll/retry loop or claim work continued while the application was closed.

The renderer owns its 180 s execution deadline and diagnostics; preparation download time is separate. A timeout means that inspection is incomplete, not that generation failed. Never mark a file visually checked solely because conversion succeeded.

## Local, Chinese and offline

Use bundled Noto Serif SC for report body and Noto Sans SC for headings/slides/tables unless the user supplied another family/template. The runtime owns whole-family substitution for missing 宋体/SimSun, 黑体/SimHei and 微软雅黑/Microsoft YaHei; do not patch individual glyphs to random fonts. Check punctuation, line breaks, mixed-script spacing, tables and text-box boundaries on the actual pages.

For HTML/design, inline local scripts, styles, images and licensed font subsets by default; requested multiple-file outputs must be self-contained with relative paths. No CDN, remote imports, update checks or runtime downloads. Rendering runs without external network access; missing remote assets are remaining issues. The existing model and, when needed, existing cloud vision are the only content-network paths. Renderer/component downloads use the host's fixed-file authority, never a script downloader.

ZIP/XML well-formedness, relationship targets and content types can be checked with bundled Python libraries. External ISO/ECMA/Microsoft/mce XSDs are not shipped, so do not claim XSD validation. Verify the resulting render and retain editable native chart/table data where the format supports it.
