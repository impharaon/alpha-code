---
name: codepuppy-document-pdf
description: Use this skill whenever the user wants to do anything with PDF files. This includes reading or extracting text/tables from PDFs, combining or merging multiple PDFs into one, splitting PDFs apart, rotating pages, adding watermarks, creating new PDFs, filling PDF forms, encrypting/decrypting PDFs, extracting images, and OCR on scanned PDFs to make them searchable. If the user mentions a .pdf file or asks to produce one, use this skill.
license: Complete terms in LICENSE.txt
---

> Code Puppy adaptation, 2026-11-26. Derived from Anthropic skills @ e4bb5d960d87126ff3b3a8af1a104b7db67560ba; see LICENSE.txt and ../document-skills.lock.json for source and changes.

Read [the document workflow](../WORKFLOW.md) before making or checking a file.

# PDF Processing Guide

## Overview

Create PDFs with bundled reportlab and edit/read them with pypdf. Use the environment's Office Python interpreter. Rendering is direct PDFium through the shared document tool. Existing reading tools remain available; do not install command-line converters or optional libraries.

## Quick Start

```python
from pypdf import PdfReader, PdfWriter

# Read a PDF
reader = PdfReader("document.pdf")
print(f"Pages: {len(reader.pages)}")

# Extract text
text = ""
for page in reader.pages:
    text += page.extract_text()
```

## Python Libraries

### pypdf - Basic Operations

#### Merge PDFs
```python
from pypdf import PdfWriter, PdfReader

writer = PdfWriter()
for pdf_file in ["doc1.pdf", "doc2.pdf", "doc3.pdf"]:
    reader = PdfReader(pdf_file)
    for page in reader.pages:
        writer.add_page(page)

with open("merged.pdf", "wb") as output:
    writer.write(output)
```

#### Split PDF
```python
reader = PdfReader("input.pdf")
for i, page in enumerate(reader.pages):
    writer = PdfWriter()
    writer.add_page(page)
    with open(f"page_{i+1}.pdf", "wb") as output:
        writer.write(output)
```

#### Extract Metadata
```python
reader = PdfReader("document.pdf")
meta = reader.metadata
print(f"Title: {meta.title}")
print(f"Author: {meta.author}")
print(f"Subject: {meta.subject}")
print(f"Creator: {meta.creator}")
```

#### Rotate Pages
```python
reader = PdfReader("input.pdf")
writer = PdfWriter()

page = reader.pages[0]
page.rotate(90)  # Rotate 90 degrees clockwise
writer.add_page(page)

with open("rotated.pdf", "wb") as output:
    writer.write(output)
```

### Text and images

Use `page.extract_text()` for selectable text and `page.images` for embedded images with pypdf. Text extraction is not visual review. When pages contain only scans, follow the workflow's actual Read/vision path and report failed or unavailable visual understanding rather than pretending OCR ran.

### reportlab - Create PDFs

#### Basic PDF Creation
```python
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas

c = canvas.Canvas("hello.pdf", pagesize=letter)
width, height = letter

# Add text
c.drawString(100, height - 100, "Hello World!")
c.drawString(100, height - 120, "This is a PDF created with reportlab")

# Add a line
c.line(100, height - 140, 400, height - 140)

# Save
c.save()
```

#### Create PDF with Multiple Pages
```python
from reportlab.lib.pagesizes import letter
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak
from reportlab.lib.styles import getSampleStyleSheet

doc = SimpleDocTemplate("report.pdf", pagesize=letter)
styles = getSampleStyleSheet()
story = []

# Add content
title = Paragraph("Report Title", styles['Title'])
story.append(title)
story.append(Spacer(1, 12))

body = Paragraph("This is the body of the report. " * 20, styles['Normal'])
story.append(body)
story.append(PageBreak())

# Page 2
story.append(Paragraph("Page 2", styles['Heading1']))
story.append(Paragraph("Content for page 2", styles['Normal']))

# Build PDF
doc.build(story)
```

#### Subscripts and Superscripts

**IMPORTANT**: Never use Unicode subscript/superscript characters (₀₁₂₃₄₅₆₇₈₉, ⁰¹²³⁴⁵⁶⁷⁸⁹) in ReportLab PDFs. The built-in fonts do not include these glyphs, causing them to render as solid black boxes.

Instead, use ReportLab's XML markup tags in Paragraph objects:
```python
from reportlab.platypus import Paragraph
from reportlab.lib.styles import getSampleStyleSheet

styles = getSampleStyleSheet()

# Subscripts: use <sub> tag
chemical = Paragraph("H<sub>2</sub>O", styles['Normal'])

# Superscripts: use <super> tag
squared = Paragraph("x<super>2</super> + y<super>2</super>", styles['Normal'])
```

For canvas-drawn text (not Paragraph objects), manually adjust font the size and position rather than using Unicode subscripts/superscripts.

## Chinese report layout

Use A4 unless the user/template specifies another size. Register bundled regular/bold static TrueType files from `environment.fonts` with reportlab `TTFont`; use Noto Serif SC for body and Noto Sans SC for headings/tables. Embed the fonts with ToUnicode so Chinese stays selectable and copyable. Do not rasterize body text to hide missing glyphs.

Use Platypus Paragraphs/Tables and page templates for flowing reports. Configure Chinese wrapping (`wordWrap="CJK"`), leading, paragraph spacing, keep-with-next headings, repeating table headers and page margins. Draw headers/footers/page numbers in the page callback with the registered Chinese family. Keep images at their aspect ratio and charts tied to real data. Follow the user-selected content and layout; do not require a style questionnaire.

## Common tasks



### Add Watermark
```python
from pypdf import PdfReader, PdfWriter

# Create watermark (or load existing)
watermark = PdfReader("watermark.pdf").pages[0]

# Apply to all pages
reader = PdfReader("document.pdf")
writer = PdfWriter()

for page in reader.pages:
    page.merge_page(watermark)
    writer.add_page(page)

with open("watermarked.pdf", "wb") as output:
    writer.write(output)
```

### Extract images

```python
from pypdf import PdfReader
from pathlib import Path

for page_number, page in enumerate(PdfReader(input_path).pages, start=1):
    for image_number, image in enumerate(page.images, start=1):
        Path(work_root, f"page-{page_number}-image-{image_number}.bin").write_bytes(image.data)
```

Keep extracted intermediates in the authorized work root; choose an output suffix from the actual image format when using an extracted image.

### Password Protection
```python
from pypdf import PdfReader, PdfWriter

reader = PdfReader("input.pdf")
writer = PdfWriter()

for page in reader.pages:
    writer.add_page(page)

# Add password
writer.encrypt("userpassword", "ownerpassword")

with open("encrypted.pdf", "wb") as output:
    writer.write(output)
```

## Review and delivery

After writing, extract text with pypdf to confirm the Chinese text, headers, footers and page numbers. Inspect the embedded font list and verify images are present. Then follow [the document workflow](../WORKFLOW.md) to render every page directly through PDFium, read the images and record actual visual coverage. Fix problems at most once and recheck; disclose remaining issues or unchecked pages.
