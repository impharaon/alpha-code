---
name: onyxia-storage-s3
description: Read and write data on Onyxia's S3/MinIO object storage (SSP Cloud), in Python (s3fs, polars, duckdb, pyarrow), in R (duckdb, arrow, aws.s3) and via the aws s3 CLI. Load whenever a task reads or writes data, mentions S3, MinIO, a bucket, remote Parquet/CSV files, the diffusion folder, or a 403 error on storage. (Mots-clés français : stockage, compartiment, lire un parquet sur S3, MinIO, dossier diffusion)
license: MIT
---

# S3/MinIO storage access on Onyxia

The datalab uses **MinIO** (Amazon S3-compatible API). Credentials are injected
automatically into the service at creation time — **never hardcode them**.

> **Golden rule**: **don't download files into the container**. Ingest data
> directly in memory / lazily from S3 (`s3fs`, `arrow`, `duckdb`). Only copy
> locally (`aws s3 cp`) if a tool truly requires a file on disk.

## 1. Check your environment before anything else

1. Verify `AWS_ACCESS_KEY_ID` and `AWS_S3_ENDPOINT` are set:
   ```bash
   echo "$AWS_ACCESS_KEY_ID" / "$AWS_S3_ENDPOINT"
   ```
2. If they are empty → token expired or service never launched → see
   [references/troubleshooting.md](references/troubleshooting.md).

See [references/env.md](references/env.md) for the full list of injected
variables and how to find your bucket name.

## 2. Pick the right tool for the job

| Task | Tool | Go to |
|---|---|---|
| Read / write DataFrames | s3fs (Python), aws.s3 (R) | [references/python.md](references/python.md) / [references/r.md](references/r.md) |
| Lazy read + filter large Parquet > 1 GB | polars `scan_parquet`, duckdb httpfs, pyarrow.dataset | [references/python.md](references/python.md) / [references/r.md](references/r.md) |
| List, copy, sync files | `aws s3`, `mc` | [references/cli.md](references/cli.md) |
| Validate credentials / token expiry | see [references/troubleshooting.md](references/troubleshooting.md) | — |

## 3. Parquet first

Prefer Parquet + lazy readers (duckdb, polars, arrow) for large volumes — column
pruning and *predicate pushdown* mean only the useful data reaches memory.

## 4. Sharing with diffusion/

Files under `s3://<bucket>/diffusion/` are readable by all authenticated
users. See [references/sharing.md](references/sharing.md).

## 5. Troubleshooting

| Symptom | First suspect | See |
|---|---|---|
| 403 / AccessDenied | Expired 7-day token | [references/troubleshooting.md](references/troubleshooting.md) |
| Endpoint works for listing but not writes | missing `https://` scheme | [references/troubleshooting.md](references/troubleshooting.md) |
| R region resolution error | must use `region = ""` | [references/troubleshooting.md](references/troubleshooting.md) |

## References

- docs.sspcloud.fr/content/storage.html
- "Python pour la data science" (L. Galiana), Parquet & cloud chapter:
  pythonds.linogaliana.fr/content/manipulation/05_parquet_s3.html
