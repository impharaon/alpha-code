---
name: r-datascience
description: R data science project standards on Onyxia, aligned with Insee's utilitR documentation — code quality (lintr, styler, functions, package::function notation), project structure (RStudio projects, subfolders, README), pinned environment with renv, targets pipelines, Parquet via arrow/duckdb, S3 access via aws.s3/arrow, tidymodels modeling. Load to create/structure an R project, write an R pipeline, produce clean R code, or whenever the task mentions renv.lock, targets, .Rproj, lintr, styler or tidymodels. (keywords: qualité du code, structure de projet, environnement figé, chaîne de traitement, bonnes pratiques R)
license: MIT
---

# R project standards (data science) on Onyxia

Core reference: **utilitR** (book.utilitr.org), Insee's collaborative
documentation on R best practices.

## Code quality (utilitR "Qualité du code")
- **Style**: follow the *tidyverse style guide*, consistently across the whole project.
  - *linter*: `lintr::use_lintr(type = "tidyverse")` then `lintr::lint_dir()`.
  - *formatter*: `styler::style_dir()` (or `styler::style_file()`).
- **DRY**: as soon as a piece of code is used more than twice, turn it into a function.
  *One task = one function*; a complex task = a chain of simple
  functions; limit global variables (avoid "spaghetti code").
- **Documentation**: document the *why* rather than the *how*; favor
  self-documentation through explicit names; document functions with `roxygen2`.
- **Remove ambiguity about packages**: `library()` for heavily used
  packages; otherwise `package::function()` notation, especially on name conflicts
  (e.g. `dplyr::select` vs `MASS::select`). The `conflicted` package helps manage them.

## Project structure (utilitR "Structure des projets")
- Always an **RStudio project** (relative paths, automatic working directory).
- **Thematic subfolders**, separating inputs / intermediates / outputs:
```
project/
├── data/
│   ├── raw/         # source data, immutable
│   └── derived/     # intermediate tables produced by the code
├── scripts/         # processing (import, cleaning…)
├── analysis/        # analyses + reports (.qmd / .Rmd)
├── output/          # RE-GENERATABLE outputs (figures, reports)
├── R/               # project functions
└── README.md        # project ID card (context, goals, usage)
```
- **Meaningful file names**, **without spaces or accents** (sources of errors).
- Large data on S3, not in Git (`onyxia-storage-s3` skill).

## Pinned environment — renv
`renv::init()` at project start, `renv::snapshot()` after each package
addition: `renv.lock` is committed (never `renv/library/`), `renv::restore()`
rebuilds the environment identically.

## Reproducible processing pipeline — targets
`targets` materializes the pipeline as a dependency graph; only the affected
steps are recomputed (`_targets.R`, `tar_make()`, `tar_visnetwork()`).
Reserve it for pipelines that warrant it (several costly steps,
non-trivial dependencies) — for a simple sequence, numbered scripts
are enough.

## Data: Parquet via arrow / duckdb
utilitR recommends `arrow` (and `duckdb`) for Parquet, including on S3 and with
lazy reading (`open_dataset() |> filter() |> ... |> collect()`).
`data.table` for in-memory performance, `tidyverse` for readability.

## Modeling — tidymodels
```r
library(tidymodels)
rec  <- recipe(cible ~ ., data = train) |> step_normalize(all_numeric_predictors())
spec <- rand_forest(trees = 500) |> set_engine("ranger") |> set_mode("classification")
wf   <- workflow() |> add_recipe(rec) |> add_model(spec)
fit  <- fit(wf, data = train)
```
Track trials via the `mlflow` package (`mlflow-tracking` skill).

## References
- book.utilitr.org (in particular "Qualité du code" and "Structure des projets")
- Insee R best-practices training: inseefrlab.github.io/formation-bonnes-pratiques-git-R
- Git workflow (`.gitignore`, commits, PRs): `git-workflow-ds` skill;
  `.qmd` publishing: `quarto-publication` skill.
