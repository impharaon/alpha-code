# Python recipes — S3/MinIO on Onyxia

All recipes read the injected `AWS_*` environment variables — never hardcode
credentials. Endpoint is always `https://$AWS_S3_ENDPOINT` (scheme required).

## s3fs (in-memory read/write, recommended)

```python
import os, s3fs, pandas as pd

fs = s3fs.S3FileSystem(
    client_kwargs={"endpoint_url": f"https://{os.environ['AWS_S3_ENDPOINT']}"}
)
BUCKET = os.environ["USERNAME"]

fs.ls(f"{BUCKET}/diffusion")                     # list

# Read / write a DataFrame (CSV: 'r'/'w'; binary Parquet: 'rb'/'wb')
with fs.open(f"{BUCKET}/diffusion/df.parquet", "rb") as f:
    df = pd.read_parquet(f)
with fs.open(f"{BUCKET}/diffusion/out.parquet", "wb") as f:
    df.to_parquet(f)

# Transfer local files <-> S3 (e.g. multi-file ShapeFile)
fs.put("local_folder/", f"{BUCKET}/diffusion/folder/", recursive=True)
fs.get(f"{BUCKET}/diffusion/folder/", "local_folder/", recursive=True)
fs.glob(f"{BUCKET}/diffusion/folder/**/COMMUNE.*")
```

## polars (lazy scan on S3)

```python
import os, polars as pl

BUCKET = os.environ["USERNAME"]
storage_options = {
    "aws_endpoint_url": f"https://{os.environ['AWS_S3_ENDPOINT']}",
    "aws_access_key_id": os.environ["AWS_ACCESS_KEY_ID"],
    "aws_secret_access_key": os.environ["AWS_SECRET_ACCESS_KEY"],
    "aws_session_token": os.environ["AWS_SESSION_TOKEN"],
}
df = (
    pl.scan_parquet(f"s3://{BUCKET}/data/RPindividus.parquet",
                    storage_options=storage_options)
    .filter(pl.col("DEPT").is_in(["11", "31", "34"]))
    .group_by("AGED", "DEPT").agg(pl.col("IPONDI").sum().alias("n"))
    .collect()          # only the filtered data reaches memory
)
```

## duckdb (large volumes, lazy reading)

Prefer these tools on Parquet: columnar reads and *predicate pushdown*
mean only the useful data reaches memory.

```python
import os, duckdb

BUCKET = os.environ["USERNAME"]
con = duckdb.connect()
con.sql("INSTALL httpfs; LOAD httpfs;")
con.sql(f"SET s3_endpoint='{os.environ['AWS_S3_ENDPOINT']}'; SET s3_use_ssl=true;")
con.sql(f"""
  FROM read_parquet('s3://{BUCKET}/data/RPindividus.parquet')
  SELECT AGED, DEPT, SUM(IPONDI) AS n WHERE DEPT IN ('11','31','34') GROUP BY AGED, DEPT
""").to_df()
```

## pyarrow (datasets, partitioned Parquet)

```python
import os, pyarrow.dataset as ds
from pyarrow import fs as pafs

BUCKET = os.environ["USERNAME"]
s3 = pafs.S3FileSystem(endpoint_override=f"https://{os.environ['AWS_S3_ENDPOINT']}")

# Lazy dataset over a (possibly Hive-partitioned) Parquet folder
dataset = ds.dataset(f"{BUCKET}/data/RPindividus_partitionne/",
                     filesystem=s3, format="parquet", partitioning="hive")
table = dataset.to_table(
    columns=["AGED", "DEPT", "IPONDI"],
    filter=ds.field("DEPT").isin(["11", "31", "34"]),
)
df = table.to_pandas()

# Write a (partitioned) dataset back to S3
ds.write_dataset(table, f"{BUCKET}/diffusion/out_dataset",
                 filesystem=s3, format="parquet",
                 partitioning=["DEPT"], existing_data_behavior="overwrite_or_ignore")
```
