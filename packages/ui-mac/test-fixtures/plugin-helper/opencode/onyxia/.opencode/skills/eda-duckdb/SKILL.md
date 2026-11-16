---
name: eda-duckdb
description: Exploratory data analysis (EDA) of datasets on S3/MinIO with duckdb, without downloading anything — profiling (SUMMARIZE), null rates, cardinalities, duplicates, distributions, temporal coverage — then a structured EDA report, optionally as a Quarto document. Use on first contact with a dataset, to profile a Parquet/CSV file, or when data is too big for pandas. (keywords: explorer, profiler, premier contact avec des données, valeurs manquantes, doublons, distribution)
license: MIT
---

# Exploratory data analysis with duckdb (over S3)

duckdb is available in every Onyxia interactive service and reads Parquet/CSV
**directly on S3, lazily** (predicate & projection pushdown). Never download a
dataset to explore it; never load it whole into pandas "just to look".

## 1. Connect duckdb to MinIO (credentials from the environment)

```sql
-- duckdb CLI or any client; httpfs ships with recent duckdb
INSTALL httpfs; LOAD httpfs;
CREATE OR REPLACE SECRET onyxia (
    TYPE S3,
    KEY_ID   getenv('AWS_ACCESS_KEY_ID'),
    SECRET   getenv('AWS_SECRET_ACCESS_KEY'),
    SESSION_TOKEN getenv('AWS_SESSION_TOKEN'),
    ENDPOINT getenv('AWS_S3_ENDPOINT'),
    URL_STYLE 'path'
);
```

In Python, `duckdb.connect()` then run the same SQL (or use
`duckdb.sql(...)`). In R, `DBI::dbConnect(duckdb::duckdb())` then `dbExecute()`
the same statements. A 403 error here = expired 7-day token → see the
`onyxia-storage-s3` skill (or run its `scripts/check_s3.sh`).

## 2. First contact — cheap, metadata-level checks first

```sql
-- schema without scanning data
DESCRIBE SELECT * FROM 's3://<bucket>/<path>/*.parquet';

-- row count (metadata-only on Parquet)
SELECT count(*) FROM 's3://<bucket>/<path>/*.parquet';

-- one-command profile: min/max/avg/std, approx_unique, null %, quartiles per column
SUMMARIZE SELECT * FROM 's3://<bucket>/<path>/*.parquet';
```

`SUMMARIZE` answers most of the EDA checklist in one scan. For very wide/large
data, `SUMMARIZE` a projection (`SELECT col1, col2, ...`) or a sample first.

## 3. EDA checklist (report these, in this order)

1. **Shape & schema**: rows, columns, types; do the types match the docs
   (dates stored as strings? codes as integers with lost leading zeros?).
2. **Missingness**: null rate per column (from `SUMMARIZE`); columns > 50% null.
3. **Duplicates & keys**: `SELECT count(*) - count(DISTINCT <candidate_key>)`;
   report candidate primary keys (approx_unique ≈ row count).
4. **Cardinalities**: near-constant columns; high-cardinality categoricals.
5. **Distributions**: numeric quartiles/outliers (from `SUMMARIZE`); for
   categoricals, `SELECT col, count(*) FROM ... GROUP BY 1 ORDER BY 2 DESC LIMIT 20`.
6. **Temporal coverage** (if any date column): `min`, `max`, gaps —
   `SELECT date_trunc('month', d), count(*) ... GROUP BY 1 ORDER BY 1`.
7. **Cross-field sanity**: totals that should add up, impossible values
   (negative ages, end < start).

## 4. Sampling — when the data is too big for pandas/ggplot

```sql
-- reproducible ~1% sample, materialized locally for plotting
COPY (SELECT * FROM 's3://<bucket>/<path>/*.parquet'
      USING SAMPLE 1 PERCENT (bernoulli, 42))
TO 'sample.parquet' (FORMAT parquet);
```

Aggregate in duckdb, plot the aggregate; only sample when you truly need
row-level plots. In Python, `duckdb.sql("...").pl()` / `.df()` hands the
(small) result to polars/pandas.

## 5. Automated profile + report

- `scripts/profile_parquet.py <s3://bucket/path.parquet>` prints a full profile
  (schema, counts, null rates, SUMMARIZE, top values of categoricals) — use it
  as the first pass, then dig where it flags something.
- For a shareable report, put the findings in a Quarto document
  (see the `quarto-publication` skill), one section per checklist item, with
  the SQL used — that makes the EDA reproducible.

## Pitfalls

- `getenv()` works in the duckdb CLI; from Python/R, passing credentials via
  `CREATE SECRET` with literal values read from `os.environ` is fine **in
  memory** but never write them to a file or notebook output.
- Globs (`/*.parquet`) unify partitioned datasets; add
  `hive_partitioning = true` to `read_parquet(...)` when partition columns are in paths.
- CSV on S3: `read_csv('s3://...', sample_size = -1)` for robust type
  inference; prefer converting to Parquet early (see `onyxia-storage-s3`).
