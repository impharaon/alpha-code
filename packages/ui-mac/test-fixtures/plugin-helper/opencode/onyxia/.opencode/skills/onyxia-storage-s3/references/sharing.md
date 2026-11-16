# Sharing with the `diffusion/` folder

The `diffusion/` folder at the root of a bucket is **readable by all
authenticated users**. This is the primary sharing / collaboration /
reproducibility mechanism on SSP Cloud.

## Workflow

1. Put data files in `s3://<bucket>/diffusion/` (write-only for you,
   readable for all authenticated users).
2. Collaborators read directly from S3 — **no need to copy**:
   ```python
   import os
   BUCKET = os.environ.get("USERNAME")
   with s3fs.S3FileSystem() as fs:
       df = pd.read_parquet(fs.open(f"{BUCKET}/diffusion/shared_data.parquet"))
   ```
3. For a multi-member project, agree on **one member's bucket** as the
   shared location. Code stays on Git, data stays in `diffusion/`.

## Production code vs collaboration

- **Production pipelines** write to a non-`diffusion/` folder (your personal
  bucket path, e.g. `s3://<bucket>/production/results/`).
- **Only `diffusion/`** is publicly readable — keep sensitive names/prefixes
  out of it.

## References

- docs.sspcloud.fr/content/storage.html (sharing section)
