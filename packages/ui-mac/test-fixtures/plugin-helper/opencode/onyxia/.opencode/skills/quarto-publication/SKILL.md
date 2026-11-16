---
name: quarto-publication
description: Author AND render/publish Quarto documents (.qmd) on Onyxia (Python & R) — HTML/PDF reports, reveal.js presentations, dashboards, websites and books; running `quarto render` in the RIGHT environment (uv/renv), embedding figures and tables, injecting computed values, parameterized documents, publishing to S3 (diffusion/ folder) or GitHub Pages. Load whenever a report, notice, presentation, dashboard or documentation must be produced or turned into a document, or when the task mentions Quarto, .qmd, "render", "quarto render", migrating an .Rmd, or an HTML/PDF render (rapport, publier, présentation, tableau de bord).
license: MIT
---

# Writing and publishing with Quarto on Onyxia

Quarto is the recommended reporting tool: code (R/Python) stays executable
and versioned **with** the report. An existing `.Rmd` usually migrates by
renaming to `.qmd` and adapting the header.

> **Golden rule**: the render must be **re-generable** (`quarto render`) —
> never hand-pasted results, never secret or sensitive data in the output.

## 1. Create the project

1. Create a `.qmd` or a project with `_quarto.yml`.
2. Read data **from S3** (`onyxia-storage-s3` skill), not from local files.
3. Optional: copy `assets/_environment` (`QUARTO_PYTHON=.venv/bin/python`)
   to your project root.

See [references/formats.md](references/formats.md) for project types (report,
presentation, dashboard, website, book).
## 2. Render — always inside the project env

```bash
uv run quarto render report.qmd        # HTML output
uv run quarto render report.qmd --to pdf
uv run quarto preview report.qmd       # live preview
```

**Never** run bare `quarto render` — it uses the system Python, not `.venv`.
See [references/rendering.md](references/rendering.md) for common pitfalls.

## 3. Embed figures

Draw in the code cell → Quarto captures it automatically (add `#| fig-cap:`).
Never use `IPython.display.Image` (does not render).

See [references/patterns.md](references/patterns.md) for code examples.

## 4. Inject computed values into prose

Use inline `` `{python} f"{value:.1f}"` ``. Not `{value}`, not
`quarto.doc.variables(...)`, not `pip install quarto`.

See [references/patterns.md](references/patterns.md).

## 5. Publish

Copy to S3 `diffusion/` or `quarto publish gh-pages`.
See [references/formats.md](references/formats.md).

## 6. Guardrails

`freeze: auto` avoids re-running unchanged chunks. Render output → `output/`
or S3, **not** Git. Proofread before publishing: no secret, no individual data.

See [references/patterns.md](references/patterns.md).
