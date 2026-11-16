# Quarto recipes: formats, parameterized documents, publishing

## Anatomy of a `.qmd`

````markdown
---
title: "RP analysis"
author: "Firstname Lastname"
format:
  html:
    toc: true
    code-fold: true
execute:
  echo: true
  warning: false
  freeze: auto        # freezes results of unmodified chunks (reproducible)
---

## Context

```{r}
library(dplyr)
# ... R code executed at render time ...
```

```{python}
import polars as pl
# ... R and Python can coexist in the same document ...
```
````

Data is read **from S3** (skill `onyxia-storage-s3`), never from a
hard-coded local path.

## Rendering and previewing (terminal)

```bash
quarto render report.qmd             # -> report.html (or pdf depending on format)
quarto render report.qmd --to pdf
quarto preview report.qmd            # live render while writing
```

## Projects: website, book, dashboard

A `_quarto.yml` at the root turns the folder into a project
(starter in [../assets/_quarto.yml](../assets/_quarto.yml)):

```yaml
project:
  type: website        # or book, or default
website:
  title: "My project"
  navbar:
    left: [index.qmd, analysis.qmd]
```

- Presentation: `format: revealjs` in the `.qmd` header.
- Dashboard: `format: dashboard` (`valuebox` components, rows/columns).

## Parameterized documents

```yaml
params:
  year: 2024
  dept: "31"
```

Access in code: `params$year` (R) / a chunk tagged `#| tags: [parameters]`
then `year` (Python). Render with other values:

```bash
quarto render report.qmd -P year:2025 -P dept:11
```

The same report thus serves several vintages/departments without
duplication. A ready-to-adapt starter is in
[../assets/report-template.qmd](../assets/report-template.qmd).

## Publishing

```bash
# 1) To the public folder of your bucket (readable by any authenticated user)
quarto render report.qmd
aws --endpoint-url "https://$AWS_S3_ENDPOINT" s3 cp report.html "s3://$USERNAME/diffusion/"
# full site: aws ... s3 sync _site/ "s3://$USERNAME/diffusion/my-site/"

# 2) To GitHub Pages (website/book project)
quarto publish gh-pages
```

## Diagnostics / common errors

- `quarto: command not found` → the service image does not ship it; use a
  recent Insee data science image (`inseefrlab/...`) which includes it.
- PDF render fails → missing LaTeX engine: `quarto install tinytex`.
- Python chunk not executed in an R project → the `reticulate` package is
  required when R and Python coexist (otherwise `engine: jupyter`).
