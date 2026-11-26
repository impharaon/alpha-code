---
name: codepuppy-document-docx
description: "Use this skill whenever the user wants to create, read, edit, or manipulate Word documents (.docx files) or Word templates (.dotx files). Triggers include: any mention of 'Word doc', 'word document', '.docx', '.dotx', or requests to produce professional documents with formatting like tables of contents, headings, page numbers, or letterheads. Also use when extracting or reorganizing content from .docx or .dotx files, inserting or replacing images in documents, performing find-and-replace in Word files, working with tracked changes or comments, or converting content into a polished Word document. If the user asks for a 'report', 'memo', 'letter', 'template', or similar deliverable as a Word or .docx file, use this skill. Do NOT use for PDFs, spreadsheets, Google Docs, or general coding tasks unrelated to document generation."
license: Complete terms in LICENSE.txt
---

> Code Puppy adaptation, 2026-11-26. Derived from Anthropic skills @ e4bb5d960d87126ff3b3a8af1a104b7db67560ba; see LICENSE.txt and ../document-skills.lock.json for source and changes.

Read [the document workflow](../WORKFLOW.md) before making or checking a file.

# DOCX creation, editing, and analysis

A `.docx` is a ZIP archive of XML files. Choose your approach by task:

| Task | Approach |
|---|---|
| **Create** a new document | Write a `docx` (npm) script — see gotchas below |
| **Edit** an existing document | unpack → edit `word/document.xml` → `zip` (docx-js cannot open existing files) |
| **Read** content | Existing `read_docx`, or the bundled python-docx/lxml libraries |

> Script paths below are relative to this skill's directory.

## Creating with docx-js — gotchas

Load docx 9.16.0 from `environment.nodeModules`, using the absolute-path CommonJS pattern in the workflow. For a new report, start from the bundled Chinese template and transfer its page/style settings into the generator. For a user template, edit its existing OOXML container instead of recreating it.

Include the requested contents, headers, footers, page numbers, images, charts, styled tables and lists. Use `TableOfContents`, `Header`, `Footer`, `PageNumber` and `ImageRun`. Produce Word charts from real data as local HTML/SVG, export PNG with `codepuppy_document` kind `design`, and insert the returned image. Do not invent a native chart API in docx-js.

- **Chinese typography:** use Noto Serif SC for body and Noto Sans SC for headings/tables by default; set eastAsia, theme major/minor, and each heading style. Preserve a requested family and the user's template styles. Use full-width Chinese punctuation, suitable line spacing, keep-with-next headings and deliberate table page breaks.

- **Page size defaults to A4.** For US Letter set `page: { size: { width: 12240, height: 15840 } }` (DXA; 1440 = 1″).
- **Landscape:** pass portrait dimensions and `orientation: PageOrientation.LANDSCAPE` — docx-js swaps width/height internally.
- **Tables need dual widths:** set `columnWidths` on the table AND `width` on every cell, both in `WidthType.DXA` (PERCENTAGE breaks in Google Docs). Column widths must sum to the table width.
- **Table shading:** use `ShadingType.CLEAR`, never `SOLID` (renders black).
- **Lists:** never insert `•` literally; use a `numbering` config with `LevelFormat.BULLET`.
- **`ImageRun` requires `type:`** (`"png"`, `"jpg"`, …).
- **`PageBreak` must be inside a `Paragraph`.**
- **Never use `\n`** — use separate `Paragraph` elements.
- **Headings:** style every level you use (`title`, `heading1`, `heading2`…) in `styles.default`: `heading1: { run: { font: "Noto Sans SC", size: 32, bold: true }, paragraph: { spacing: { before: 240, after: 120 }, keepNext: true } }`. Every level needs its own font (even with a document default), `before` and `after` (even if 0) and `keepNext`: the built-in styles set none of them.
- **TOC:** headings must use built-in `HeadingLevel.*`; custom heading styles need `outlineLevel` set or they won't appear.
- **Don't use a table as a horizontal rule** — use a paragraph bottom border instead.
- **Dot-leader / right-aligned-on-same-line:** use `PositionalTab` (`alignment: PositionalTabAlignment.RIGHT`, `leader: PositionalTabLeader.DOT`) inside a `TextRun`, not literal `.` or space padding.

## Verify the output

Check ZIP/XML well-formedness, relationship targets and content types with the bundled Python libraries. External ISO/ECMA/Microsoft/mce XSDs are not distributed; do not claim schema validation ran. Follow the workflow's LibreOffice render → per-page Read → check sequence. The TOC and page-number fields must contain visible, accurate content in the delivered document, not just empty fields that need a user refresh. When needed, fill the TOC body/cache from actual rendered page numbers during the single correction round and render it again.

## Editing existing documents

Use the existing reader to understand the content. Open the OOXML ZIP with Python `zipfile`; parse XML with bundled lxml using external entities and network access disabled. Preserve namespace declarations, styles, sections, headers, footers, masters and relationships. Word often splits one visible phrase across multiple runs: locate adjacent text nodes and change the relevant runs while preserving their formatting, rather than replacing the entire paragraph with plain text.

Rebuild the package from its actual entries, keeping unrelated parts, then atomically publish it as described in the workflow. Do not extract untrusted ZIP entries outside the job directory or invoke system ZIP/Office conversion commands. Check the final package relationships and render the actual result.

**Tracked changes:** explicitly inspect that requested redlines wrap each changed run; the external XSD/redlining validator is not bundled. Wrap runs in `<w:ins>`/`<w:del>` with `w:id`, `w:author`, `w:date` attributes. Inside `<w:del>`, the text element is `<w:delText>`, not `<w:t>`. A deleted paragraph mark (`<w:pPr><w:rPr><w:del w:id=".." w:author=".." w:date=".."/></w:rPr></w:pPr>`) means "merge this paragraph into the next" — so deleting a paragraph outright is that plus a `<w:del>` around every run. The `<w:del/>` must come before the rPr's other children; their order is schema-enforced.

When accepting tracked changes, remove deleted runs and join paragraphs whose paragraph marks were deleted; do not leave empty numbered bullets. Check the XML and the rendered result, because text extraction alone can hide these artifacts.

## Comments

Comments require the comments parts, relationships and content-type overrides, as well as matching `commentRangeStart`, `commentRangeEnd` and `commentReference` anchors in `word/document.xml`. Preserve existing IDs and assign new IDs without collisions. Escape text through the XML library rather than string interpolation. A comment part without anchors is not a visible comment.

## Runtime

Use the bundled docx npm library and Office Python libraries from the environment. Rendering and visual review use [the document workflow](../WORKFLOW.md); template/theme guidance is in `codepuppy-document-theme-factory`.
