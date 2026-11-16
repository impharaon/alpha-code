---
name: python-datascience
description: Python data science / ML project standards on Onyxia, aligned with "Python pour la data science" (Lino Galiana, ENSAE) — uv environment, ruff quality, pytest tests, pandas/polars data wrangling, performant Parquet reading with pyarrow/duckdb, scikit-learn pipelines, serving via FastAPI. Load to create/structure a Python project, choose libraries, write clean Python ML code, or whenever the task mentions pyproject.toml, uv.lock, a notebook to industrialize, ruff, pytest or scikit-learn. (keywords: manipulation de données, librairies, industrialiser un notebook, mise à disposition, qualité de code)
license: MIT
---

# Python project standards (data science / ML) on Onyxia

Core reference: **"Python pour la data science"** by Lino Galiana
(pythonds.linogaliana.fr).

## 1. Initial project

```bash
uv init my-project && cd my-project
uv add polars pandas pyarrow duckdb scikit-learn mlflow s3fs
uv add --dev ruff pytest mypy
```

`pyproject.toml` + `uv.lock` committed; `.venv/` never committed.
See [references/setup.md](references/setup.md).

## 2. Structure

See [references/structure.md](references/structure.md).

Golden rules: production code in `src/` (not notebooks), parameters in
`conf/*.yaml` (not in code), secrets in Vault, data on S3 (`onyxia-storage-s3`).

## 3. Data wrangling

| Volume | Tool |
|---|---|
| Small / medium | [pandas](references/data-wrangling.md) |
| Large, lazy read | [polars scan_parquet](references/data-wrangling.md) |
| Very large, SQL-style | [duckdb httpfs](references/data-wrangling.md) |

Parquet first, lazy readers first.

## 4. Code quality — run before every commit

```bash
uv run ruff format . && uv run ruff check --fix . && uv run pytest -q && uv run mypy src/
```

See [references/code-quality.md](references/code-quality.md).

## 5. Modeling — scikit-learn

- All preprocessing in a `Pipeline` + `ColumnTransformer` (no data leakage).
- Split train/valid/test, fix seed, cross-validate, metric suited to problem.
- Track every trial with MLflow (`mlflow-tracking` skill).

See [references/modeling.md](references/modeling.md).

## 6. Serving — FastAPI

Expose predictions via FastAPI → containerize → deploy (`argo-mlops`).
See [references/serving.md](references/serving.md).
