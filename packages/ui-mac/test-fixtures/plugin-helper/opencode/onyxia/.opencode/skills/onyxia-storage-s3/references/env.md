# Environment variables & bucket naming

## Injected variables

| Variable | Role |
|---|---|
| `AWS_ACCESS_KEY_ID` | S3/MinIO access key |
| `AWS_SECRET_ACCESS_KEY` | S3/MinIO secret key |
| `AWS_SESSION_TOKEN` | Temporary token (7 days) |
| `AWS_DEFAULT_REGION` | Region (usually `us-east-1` on MinIO) |
| `AWS_S3_ENDPOINT` | MinIO host **only**, no scheme (e.g. `minio.lab.sspcloud.fr`) |

## Bucket name

Your personal bucket = your SSP Cloud username.

> **Critical on pods**: in a Kubernetes pod the shell variable `$USERNAME` is
> the generic service account (e.g. `onyxia`), **not** your real username.
> The actual username lives in `$VAULT_TOP_DIR` (or `$KUBERNETES_NAMESPACE`
> minus its `user-` prefix).
>
> ```python
> import os
> BUCKET = os.environ.get("USERNAME") or os.environ.get("VAULT_TOP_DIR")
> ```
>
> ```r
> bucket <- Sys.getenv("USERNAME")
> if (bucket == "onyxia" || grepl("^user-", bucket)) {
>   bucket <- Sys.getenv("VAULT_TOP_DIR")
> }
> ```

## Token expiry

Temporary tokens are valid for **7 days**. When they expire:

1. The service shows up in **red** in "My services"
2. Any S3 operation returns a **403** error

Remedies:
- **Relaunch the service** (simplest — fresh token)
- Copy data/code and recreate from the Onyxia console

See also [references/troubleshooting.md](troubleshooting.md) for diagnostics.
