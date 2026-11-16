---
name: data-validation
description: Validate data quality with explicit, testable expectations — schema and constraint checks with pandera (Python) or pointblank (R), duckdb assertion queries for large S3 data, and wiring checks into targets/Argo pipelines with a clear fail-vs-warn policy. Use when data needs guarantees before analysis or production, when ingesting a new source, or when a pipeline must refuse bad inputs. (keywords: qualité des données, valider, contrôles, contraintes, schéma, données invalides)
license: MIT
---

# Data validation

A check that only lives in someone's head is not a check. Encode expectations
as code, run them where the data enters, and decide **fail vs warn** per rule.

## One tool per language

**Python — `pandera`** (`uv pip install "pandera[polars]"` — works on pandas & polars):

```python
import pandera.polars as pa

schema = pa.DataFrameSchema(
    {
        "siren": pa.Column(str, pa.Check.str_matches(r"^\d{9}$")),
        "effectif": pa.Column(int, pa.Check.ge(0), nullable=True),
        "dep": pa.Column(str, pa.Check.isin(VALID_DEPS)),
        "date_creation": pa.Column("date", pa.Check.le(TODAY)),
    },
    unique=["siren"],
    strict=True,          # unexpected columns are an error: schema drift surfaces early
)
validated = schema.validate(df, lazy=True)   # lazy=True → collect ALL failures, not the first
```

`lazy=True` then `err.failure_cases` gives a per-row, per-check failure table —
log it, don't just crash.

**R — `pointblank`** (validate + document in one object):

```r
library(pointblank)
agent <- create_agent(tbl = df, actions = action_levels(warn_at = 0.01, stop_at = 0.05)) |>
  col_vals_regex(siren, "^\\d{9}$") |>
  col_vals_gte(effectif, 0, na_pass = TRUE) |>
  col_vals_in_set(dep, valid_deps) |>
  rows_distinct(columns = vars(siren)) |>
  interrogate()
agent   # prints an HTML validation report; get_agent_report() to export
```

(`validate::confront()` is a fine lighter alternative if pointblank is too heavy.)

## Large data on S3 — assert in duckdb, don't load

Validate **before** materializing, with queries that return offending rows:

```sql
-- each check: a query that must return 0 rows
SELECT count(*) AS bad FROM read_parquet('s3://…/*.parquet')
WHERE effectif < 0 OR siren !~ '^\d{9}$';

SELECT siren, count(*) FROM read_parquet('s3://…/*.parquet')
GROUP BY siren HAVING count(*) > 1 LIMIT 20;   -- sample of duplicates for the report
```

Wrap the set of queries in a small script that prints per-check counts and
exits non-zero if any "fail-level" check has `bad > 0`.

## Fail vs warn policy

- **Fail (stop the pipeline)**: structural breaks — schema mismatch, key
  duplicated, impossible values that downstream code silently mangles.
- **Warn (log + continue)**: distribution drift, unusual-but-legal values,
  missing rates slightly above baseline. Route warnings to the run report
  (MLflow tags/artifacts fit well — see `mlflow-tracking`).
- Thresholds beat booleans for drift-type checks (e.g. pointblank's
  `warn_at`/`stop_at` fractions).

## Wiring into pipelines

- **`targets` (R)**: make the validation an explicit target between ingestion
  and modelling; downstream targets depend on it, so a failure stops the DAG.
- **Argo Workflows**: a dedicated validation step right after ingestion; its
  non-zero exit fails the workflow (see `argo-mlops`). Save the failure-case
  table as an artifact on S3 so failures are inspectable.
- Keep validation rules **in the repo, versioned** next to the ingestion code
  they protect (see `git-workflow-ds`); update them deliberately, in reviewed
  commits, when the source legitimately changes.
