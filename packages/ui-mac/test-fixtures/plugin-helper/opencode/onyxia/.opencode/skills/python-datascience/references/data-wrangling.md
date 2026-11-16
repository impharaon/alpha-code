# Data wrangling: the right tool for the volume

**Parquet first**: prefer Parquet + lazy readers (duckdb, polars, arrow).

## pandas — comfort, small/medium volumes

```python
import pandas as pd
df = pd.read_csv("data/inputs.csv")
df.groupby("dept").agg(n=("value", "sum"))
df.to_parquet("data/out.parquet")
```

## polars — fast DataFrames, *lazy* on large volumes

```python
import polars as pl

df = (
    pl.scan_parquet("data/RP.parquet")          # lazy: no data loaded yet
    .filter(pl.col("aged") > 20)
    .group_by("aged", "dept")
    .agg(pl.col("ipondi").sum().alias("n"))
    .collect()                                   # materialize only filtered/agg'd data
)
```

## duckdb — SQL on Parquet (predicate & projection pushdown)

```python
import duckdb

duckdb.sql("""
    SELECT aged, dept, SUM(ipondi) AS n
    FROM read_parquet('data/RP.parquet')
    WHERE aged > 20
    GROUP BY aged, dept
""").to_df()
```

## Partitioned datasets

Partition by a column you often filter on:

```python
pq.write_to_dataset(df, "data/partitioned", partition_cols=["dept"])

# Read with predicate pushdown
table = ds.dataset("data/partitioned", partitioning="hive").to_table(
    filter=ds.field("dept").isin(["18", "36"]),
    columns=["aged", "ipondi"]
)
```

## S3 access

Stream from S3 first. Recipes in `onyxia-storage-s3` skill:
[references/python.md](../../onyxia-storage-s3/references/python.md).
