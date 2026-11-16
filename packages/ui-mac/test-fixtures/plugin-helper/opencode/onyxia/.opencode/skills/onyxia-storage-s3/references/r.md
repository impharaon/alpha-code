# R recipes — S3/MinIO on Onyxia

All recipes read the injected `AWS_*` environment variables — never hardcode
credentials. With MinIO, use `region = ""` to avoid spurious AWS region
resolution.

## duckdb (recommended for Parquet on S3)

DuckDB reads/writes Parquet on MinIO through the `httpfs` extension, with
lazy reading and *predicate pushdown*. S3 access is configured from the
injected environment variables (via DuckDB's *secrets manager*).

```r
library(duckdb); library(DBI); library(dplyr)

con <- dbConnect(duckdb::duckdb())
dbExecute(con, "INSTALL httpfs; LOAD httpfs;")

# MinIO access from the AWS_* variables (path-style + SSL are mandatory)
dbExecute(con, sprintf("
  CREATE OR REPLACE SECRET minio (
    TYPE s3, KEY_ID '%s', SECRET '%s', SESSION_TOKEN '%s',
    ENDPOINT '%s', USE_SSL true, URL_STYLE 'path'
  );",
  Sys.getenv("AWS_ACCESS_KEY_ID"), Sys.getenv("AWS_SECRET_ACCESS_KEY"),
  Sys.getenv("AWS_SESSION_TOKEN"), Sys.getenv("AWS_S3_ENDPOINT")))

BUCKET <- Sys.getenv("USERNAME")

# 1) Direct SQL query
df <- dbGetQuery(con, sprintf("
  SELECT AGED, DEPT, SUM(IPONDI) AS n
  FROM read_parquet('s3://%s/data/RPindividus.parquet')
  WHERE DEPT IN ('18','28','36')
  GROUP BY AGED, DEPT", BUCKET))

# 2) dplyr style (lazy reading) through a view on the partitioned dataset
dbExecute(con, sprintf("CREATE VIEW rp AS
  SELECT * FROM read_parquet('s3://%s/data/RPindividus_partitionne/**/*.parquet',
                             hive_partitioning = true);", BUCKET))
res <- tbl(con, "rp") |>
  filter(DEPT %in% c("18", "28", "36")) |>
  group_by(AGED, DEPT) |> summarise(n = sum(IPONDI), .groups = "drop") |>
  collect()

# Write to S3
dbExecute(con, sprintf("COPY (SELECT * FROM rp) TO 's3://%s/diffusion/out.parquet'
                        (FORMAT parquet);", BUCKET))

dbDisconnect(con, shutdown = TRUE)
```

## aws.s3 (alternative, CSV / miscellaneous files)

```r
library(aws.s3)
bucket <- Sys.getenv("USERNAME")
df <- s3read_using(readr::read_csv, object = "data/t.csv", bucket = bucket, opts = list(region = ""))
s3write_using(df, arrow::write_parquet, object = "out/t.parquet", bucket = bucket, opts = list(region = ""))
```

## arrow (lazy datasets, dplyr-friendly)

```r
library(arrow); library(dplyr)

minio <- S3FileSystem$create(
  endpoint_override = Sys.getenv("AWS_S3_ENDPOINT"),
  access_key    = Sys.getenv("AWS_ACCESS_KEY_ID"),
  secret_key    = Sys.getenv("AWS_SECRET_ACCESS_KEY"),
  session_token = Sys.getenv("AWS_SESSION_TOKEN"),
  scheme = "https"
)
BUCKET <- Sys.getenv("USERNAME")

# Lazy dataset over a (possibly Hive-partitioned) Parquet folder
res <- open_dataset(minio$path(file.path(BUCKET, "data/RPindividus_partitionne"))) |>
  filter(DEPT %in% c("18", "28", "36")) |>
  group_by(AGED, DEPT) |> summarise(n = sum(IPONDI)) |>
  collect()   # only the filtered data reaches memory

# Single-file read / write
df <- read_parquet(minio$path(file.path(BUCKET, "diffusion/df.parquet")))
write_parquet(df, minio$path(file.path(BUCKET, "diffusion/out.parquet")))
```
