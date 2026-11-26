---
name: codepuppy-document-pptx
description: "Use this skill any time a .pptx or .potx file is involved in any way — as input, output, or both. This includes: creating slide decks, pitch decks, or presentations; reading, parsing, or extracting text from any .pptx or .potx file (even if the extracted content will be used elsewhere, like in an email or summary); editing, modifying, or updating existing presentations; combining or splitting slide files; working with templates (.potx), layouts, speaker notes, or comments. Trigger whenever the user mentions \"deck,\" \"slides,\" \"presentation,\" or references a .pptx or .potx filename, regardless of what they plan to do with the content afterward. If a .pptx or .potx file needs to be opened, created, or touched, use this skill."
license: Complete terms in LICENSE.txt
---

> Code Puppy adaptation, 2026-11-26. Derived from Anthropic skills @ e4bb5d960d87126ff3b3a8af1a104b7db67560ba; see LICENSE.txt and ../document-skills.lock.json for source and changes.

Read [the document workflow](../WORKFLOW.md) before making or checking a file.

# PPTX creation, editing, and analysis

A `.pptx` is a ZIP archive of XML files. Choose your approach by task:

| Task | Approach |
|---|---|
| **Create** a new deck | Write a `pptxgenjs` script — see gotchas below — and build it as a [structured deck](#structured-decks) unless the user asks for a quick throwaway |
| **Edit** an existing deck, or build from a template | unpack → edit `ppt/slides/slideN.xml` → zip |
| **Read** content | Existing `read_pptx`, bundled python-pptx/lxml; for appearance, use document.render and Read every returned page |

## Runtime and template selection

Use PptxGenJS 4.0.1 through `environment.node` and the absolute `environment.nodeModules` path. New decks start from the bundled Chinese presentation's theme/layout basis. A user-supplied template takes precedence: edit that OOXML container and preserve its slide masters, theme, relationships and layouts, rather than building an unrelated deck with similar colors.

The bundled helper [scripts/apply_theme.cjs](scripts/apply_theme.cjs) applies a new deck's colors after writing it. Call `applyTheme(deckPath, THEME, environment.nodeModules)`; it resolves the existing JSZip closure from the specified PptxGenJS installation. Use it only for new PptxGenJS decks, not to overwrite a user's template theme.

## Creating with pptxgenjs — gotchas

Load the npm module by absolute path as shown in [the workflow](../WORKFLOW.md). Do not assume a globally installed package or add a runtime installer.

- **Set `pres.layout` before adding slides.** The default canvas is `LAYOUT_16x9` = **10" × 5.625"**, not 13.3" wide. Coordinates past the edge are written, not clamped — the shape just isn't on the slide. (`LAYOUT_WIDE` is 13.3" × 7.5".)
- **Hex colors: never `#`, never 8 digits.** `color: "FF0000"`. Both `"#FF0000"` and alpha baked into the hex (`"00000020"`) **corrupt the file**. For translucency: `transparency: 0-100` on fills and images, `opacity: 0.0-1.0` on shadows — each is silently ignored on the other.
- **pptxgenjs mutates option objects in place** (converts values to EMU on first use). Never share one `shadow`/options object across two `add*` calls — build a fresh object each time.
- **Shadow `offset` must be ≥ 0** — a negative offset corrupts the file. To cast a shadow upward, use `angle: 270` with a positive offset.
- **`letterSpacing` is silently ignored** — the real option is `charSpacing`.
- **Lists:** `bullet: true` on each item, never a literal `•` (renders double bullets). Set `breakLine: true` on every array item except the last. Space bulleted paragraphs with `paraSpaceAfter`, not `lineSpacing` (huge gaps).
- **One `new pptxgen()` per output file** — never reuse an instance.
- **`rectRadius` only works on `ROUNDED_RECTANGLE`**, not `RECTANGLE`.
- **Gradient fills aren't supported** — use a gradient image as the background instead.
- **Every `addText` call without a `placeholder` needs `isTextBox: true`** — without it the shape lacks `txBox="1"`, so screen readers announce the text as a "graphic" instead of a text box. No visual change.
- **Text boxes have built-in internal padding** — set `margin: 0` whenever text must align with a shape, line, or icon at the same x.
- **Speaker notes go in `slide.addNotes("...")`** (plain text, once per slide), never in a text box on the slide.
- **Keep charts native.** Use `addChart()` for everything PowerPoint can chart (pass an array of `{type, data, options}` for combos). For PowerPoint-native features the library doesn't expose (trendlines, error bars), compute the extra series yourself or post-process the generated OOXML — do not fall back to a rendered image. Only chart types PowerPoint has no native form for (Sankey, network, chord) go in as images.
- **Default charts render bare** — no title, no data labels, dated palette. Set `showTitle` + `title`, `showValue: true` + `dataLabelPosition`, `chartColors: [...]` from your palette, and quiet the frame (`catAxisLabelColor`/`valAxisLabelColor`, `valGridLine: { color, size }`, `catGridLine: { style: "none" }`, `showLegend: false` for a single series).
- **On a stacked bar or column chart, `dataLabelPosition` must be `ctr`, `inEnd`, or `inBase`.** `outEnd` **corrupts the file**.
- **A combo series using `secondaryValAxis`/`secondaryCatAxis` needs both `valAxes` and `catAxes` on the chart options, two entries each.** Without them pptxgenjs writes axis *ids* it never declares, and PowerPoint **discards that chart** and reports the file as corrupt. Supplying only `valAxes` is not enough.
- **After `writeFile()`, check ZIP/XML, relationships, content types and chart references, then follow the workflow to render the actual output.** No external XSD validation is claimed.
- **Never reorder the children of `<p:presentation>`.** pptxgenjs writes `<p:notesMasterIdLst>` right after `<p:sldIdLst>` and points both masters at one theme part. PowerPoint reads that happily — move the element and the same deck becomes unopenable.
- **Icons:** compose SVG or HTML locally, export PNG through the same Chromium design renderer, and insert the image with its real dimensions. Use no online icon/font service or extra npm packages.
- **`defineSlideMaster()` creates a slide *layout*, not a master** — one `slideLayoutN.xml` per call, under a single master you cannot change. Call them layouts when talking to the user.
- **`pres.company` and a `defineSlideMaster()` `title` are written into the XML unescaped** — an `&` in either (`"Harrow & Sons"`) leaves `docProps/app.xml` or the layout unparseable, and XML parsing fails. Write `&amp;` there, and in the matching `masterName`. `title`, `subject`, `author`, section titles, `objectName`, notes and slide text are escaped for you.

### Structured decks

A deck built on a theme, layouts, placeholders and sections can be restyled in one place and edited in PowerPoint without fighting it. Build every new deck this way unless the user asks for a quick throwaway.

1. **Theme first:** `const THEME = { name, headFontFace, bodyFontFace, colors: { dk1, lt1, dk2, lt2, accent1 … accent6, hlink, folHlink } }`, colors in hex. `pres.theme` takes the two fonts and nothing else. Name no font after that — titles get the heading font, other text the body font — except on chart text, which is hard-coded Arial: give its `*FontFace` options `"+mn-lt"` (theme body font; `"+mj-lt"` is the heading font).
2. **`const C = pres.SchemeColor` for every color** — `C.text1`/`C.text2` are `dk1`/`dk2`, `C.background1`/`C.background2` are `lt1`/`lt2`. These take hex only, read from `THEME`: `valGridLine.color`, `catGridLine.color`, `shadow.color`, and on a one-series bar chart `invertedColors` or more than one `chartColors`. A scheme color there is written as `<a:srgbClr val="bg2"/>` without complaint, and being hex, these will not follow a later change of theme.
3. **Sections:** `pres.addSection({ title })` just before that section's first slide, then `sectionTitle` on every `addSlide`. A slide without one — or, when sections are all declared up front, a table's auto-paged continuation slides — lands in a stray "Default-N" section.
4. **One layout per slide frame** (`defineSlideMaster()`): title, section divider, title only, chart + commentary, table; dark and light variants if the design alternates. Text regions are named placeholders carrying position, size, weight and `color` — chart, image and table placeholders need a `color` too, or prompt text and arrays of runs come out hard-coded `000000`. Footer text, logo and `slideNumber` go on the layout, never on a slide.
5. **Fill by name:** `addSlide({ masterName, sectionTitle })`, then `addText("…", { placeholder: "title" })` with no position, size or color — the placeholder's own options win, and anything it doesn't set (italic, `align`, `fontFace`) still applies; style one run with `[{ text, options }]`. A misspelt `placeholder` or `masterName` fails silently (a stray text box at 0,0; the blank layout). Only `title`, `body` and `chart` placeholders fill by name alone: `addImage({ placeholder })` takes the placeholder's x and y but not its size (a 1" × 1" picture) — pass `w`/`h` too. `addTable({ placeholder })` takes its x and y only — always pass `w`; when it auto-pages it ignores the placeholder and runs off the slide, so also pass `x`, `y` and `autoPageSlideStartY` (same as `y`, or continuation pages are laid out from the top margin), give the layout a `margin` whose bottom clears the footer, and fill the continuation slides' titles through `slide.newAutoPagedSlides`.
6. **A layout is the frame, not the "layout" Design Ideas means.** Cards, icons, stat callouts and images are still composed slide by slide on top of it, in scheme colors, each with an `objectName` — every Design Idea applies, and most content slides sit on the title-only layout.
7. **Write, then apply the theme:** `await pres.writeFile({ fileName: "deck.pptx" })`, then `await applyTheme("deck.pptx", THEME, environment.nodeModules)`. pptxgenjs cannot write theme colors: until this runs, scheme colors resolve to Office's stock palette. It throws, changing nothing, on a scheme color in a hex-only option — fix what it names and rebuild.

## Editing existing decks and templates

Render the user template through `codepuppy_document`, inspect its actual slides and read its structure. Map content onto appropriate existing layouts, varying layouts to suit the narrative.

Use Python `zipfile` plus bundled lxml (external entities/network disabled) to edit the existing container. Duplicate a slide together with its relationships and content-type registration; clone chart/embedded-object parts when the copy must be independently editable. Update `<p:sldIdLst>` for ordering, then remove only proven orphan parts. Make structural changes before filling content to avoid cloning edited text accidentally.

Preserve masters, themes, notes, media and namespace bindings. Prefer changing individual runs to replacing a whole text frame, which loses formatting. Do not pass SVG/EMF to a raster-only picture API. Rebuild from actual entries and atomically publish the package; verify relationship targets and content types. The external XSD validator and sandbox conversion/thumbnail scripts are not included.

When filling in a template:

- If you script an XML transform, parse with bundled lxml configured with external entities and network access disabled — round-tripping OOXML through `xml.etree.ElementTree` rewrites namespace prefixes and corrupts the deck.
- **Template slots ≠ source items.** If the template shows 4 team members and you have 3, delete the 4th member's entire group (image + text boxes), not just its text — then check for orphaned visuals in QA.
- One `<a:p>` per list item — never concatenate items into a single paragraph. Copy the sibling `<a:pPr>` to preserve spacing, and put `b="1"` on the `<a:rPr>` of titles, section headers, and inline labels (`Status:`, `Owner:`).
- Let bullets inherit from the layout; only add `<a:buChar>`, `<a:buAutoNum>` (numbered), or `<a:buNone>` to override — never a literal `•` in the text.
- Text with leading or trailing spaces needs `xml:space="preserve"` on its `<a:t>`.

## Deck content and flow

- **One message per slide.** A deck goes theme by theme, message by message.
- **A common structure is the pyramid:** the main message up front, an executive summary that previews the sections, the sections themselves, then a conclusion, usually with next steps that act on the findings.
- **Match the structure to the size of the deck.** A short deck might not need an introduction and a conclusion; a long deck might need dividers between topics.
- **Build toward what the deck is for:** a decision, consensus, a celebration, resolving a disagreement, or opening a discussion.
- **Build for how it will be used.** A live deck gets narration and possibly discussion; a pre-read has to carry the whole narrative itself. An executive audience in a live meeting needs few words and highly visual slides. Detailed, word-heavy slides are sometimes right for subject-matter experts or for a deck read offline. Analytical reports lean on charts and tables.
- **Size a live deck to the talk:** about 1.5 to 2 minutes per slide, with time left for questions if there will be any.

## Design Ideas

**Don't create boring slides.** Plain bullets on a white background won't impress anyone. Consider ideas from this list for each slide.

### Before Starting

- **Pick a bold, content-informed color palette**: The palette should feel designed for THIS topic. If swapping your colors into a completely different presentation would still "work," you haven't made specific enough choices.
- **Dominance over equality**: One color should dominate (60-70% visual weight), with 1-2 supporting tones and one sharp accent. Never give all colors equal weight.
- **Dark/light contrast**: Dark backgrounds for title + conclusion slides, light for content ("sandwich" structure). Or commit to dark throughout for a premium feel.
- **Commit to a visual motif**: Pick ONE distinctive element and repeat it — rounded image frames, icons in colored circles. Carry it across every slide. **Do not use a color bar or accent stripe as your motif** (see Avoid list).

### Color Palettes

Choose colors that match your topic — don't default to generic blue. Use these palettes as inspiration:

| Theme | Primary | Secondary | Accent |
|-------|---------|-----------|--------|
| **Midnight Executive** | `1E2761` (navy) | `CADCFC` (ice blue) | `FFFFFF` (white) |
| **Forest & Moss** | `2C5F2D` (forest) | `97BC62` (moss) | `F5F5F5` (cream) |
| **Coral Energy** | `F96167` (coral) | `F9E795` (gold) | `2F3C7E` (navy) |
| **Warm Terracotta** | `B85042` (terracotta) | `E7E8D1` (sand) | `A7BEAE` (sage) |
| **Ocean Gradient** | `065A82` (deep blue) | `1C7293` (teal) | `21295C` (midnight) |
| **Charcoal Minimal** | `36454F` (charcoal) | `F2F2F2` (off-white) | `212121` (black) |
| **Teal Trust** | `028090` (teal) | `00A896` (seafoam) | `02C39A` (mint) |
| **Berry & Cream** | `6D2E46` (berry) | `A26769` (dusty rose) | `ECE2D0` (cream) |
| **Sage Calm** | `84B59F` (sage) | `69A297` (eucalyptus) | `50808E` (slate) |
| **Cherry Bold** | `990011` (cherry) | `FCF6F5` (off-white) | `2F3C7E` (navy) |

### For Each Slide

**Every slide needs a visual element** — image, chart, icon, or shape. Text-only slides are forgettable.

**Layout options:**
- Two-column (text left, illustration on right)
- Icon + text rows (icon in colored circle, bold header, description below)
- 2x2 or 2x3 grid (image on one side, grid of content blocks on other)
- Half-bleed image (full left or right side) with content overlay

**Data display:**
- Large stat callouts (big numbers 60-72pt with small labels below)
- Comparison columns (before/after, pros/cons, side-by-side options)
- Timeline or process flow (numbered steps, arrows)

**Visual polish:**
- Icons in small colored circles next to section headers
- Italic accent text for key stats or taglines

### Typography

Use bundled Noto Sans SC for Chinese slide text and set both latin/ea runs and theme fonts. Preserve a user's specified family; the rendering runtime owns whole-family fallback for missing Chinese fonts. For a mixed-font paragraph, check the actual rendered line widths rather than assuming an Office font is installed. Leave room for Chinese punctuation and line breaks; never split a number from its unit or overflow a text box.

These sizes are starting points, adjusted to the template, canvas and viewing context:

| Element | Size |
|---------|------|
| Slide title | 36-44pt bold |
| Section header | 20-24pt bold |
| Body text | 14-16pt |
| Captions | 10-12pt muted |

### Spacing

- Aim for 0.5" margins on a conventional wide slide; adjust to the actual template
- 0.3-0.5" between content blocks
- Leave breathing room—don't fill every inch

### Avoid (Common Mistakes)

- **Don't repeat the same layout** — vary columns, cards, and callouts across slides
- **Don't end a slide title with a period**
- **Don't let titles drift between slides of the same type** — content slides with the title at the top put it at the same position, font, size, and alignment on every slide; a different slide type (a section divider with the title mid-slide) can place it differently
- **Don't change how chart labels look from chart to chart** — axis and data labels use the same color, font, and size on every chart in the deck; vary one only where a chart needs it (a second axis, a highlighted series, a label sitting on a dark bar)
- **Don't center body text** — left-align paragraphs and lists; center only titles
- **Don't skimp on size contrast** — titles need 36pt+ to stand out from 14-16pt body
- **Don't default to blue** — pick colors that reflect the specific topic
- **Don't mix spacing randomly** — choose 0.3" or 0.5" gaps and use consistently
- **Don't style one slide and leave the rest plain** — commit fully or keep it simple throughout
- **Don't create text-only slides** — add images, icons, charts, or visual elements; avoid plain title + bullets
- **Don't forget text box padding** — when aligning lines or shapes with text edges, set `margin: 0` on the text box or offset the shape to account for padding
- **Don't use low-contrast elements** — icons AND text need strong contrast against the background; avoid light text on light backgrounds or dark text on dark backgrounds
- **NEVER use accent lines under titles** — these are a hallmark of AI-generated slides; use whitespace or background color instead
- **NEVER add decorative color bars or accent stripes** — this includes: header/footer bars spanning the slide width, vertical sidebar stripes down one edge of the slide, thin accent stripes along one edge of a card or content block, and "single-side borders" on rectangles. These read as AI-generated filler. If you want to set a card apart, use a subtle background tint, a drop shadow, or an icon — not an edge stripe.
- **Don't default to cream/beige backgrounds** — when no background is specified, use white (`FFFFFF`) or the user's brand palette; avoid warm-neutral defaults like `F5F5DC`, `FAF0E6`, `FAEBD7`, `FFF8E1`
- **Don't ship text that overflows its shape** — if text doesn't fit, reduce font size, split across slides, or enlarge the container; never leave content cut off or spilling past bounds. Use the Typography table as guidance; prefer clearer phrasing, larger containers or a suitable layout rather than unreadably small text. Preserve the requested slide count and required content; when editing a template, match its sizes

## Content, file and visual review

Read slide text, native chart data, tables and speaker notes with the bundled libraries or existing reader. Check missing content, typo/order errors and template placeholders. Check ZIP/XML well-formedness, relationship targets, content types and chart axes; structural checks are not a claim of XSD validation. Remove obsolete animation references when deleting an animated object.

Follow [the document workflow](../WORKFLOW.md): LibreOffice → PDFium pages → Read every page → check, with at most one combined correction and a complete re-render/review. Inspect overflow first, then overlaps, cropped pictures, footer collisions, uneven spacing, alignment, contrast, wrapping and chart labels. Compare slides of the same type for consistent title positions and labels. Native charts must keep editable data and speaker notes must remain notes. Report unresolved issues after the correction, and deliver the file even if a visual or runtime check is incomplete.
