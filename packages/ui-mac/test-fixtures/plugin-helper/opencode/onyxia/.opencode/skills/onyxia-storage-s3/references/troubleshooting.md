# Troubleshooting S3/MinIO

## 403 / AccessDenied / ExpiredToken (first hypothesis)

A **403** error on MinIO almost always means the **7-day S3 token has expired**.
Suspect expiration **before any other diagnosis**.

**Check**: run the diagnostic script or test with a simple listing:
```bash
bash scripts/check_s3.sh
# or quick check:
aws --endpoint-url "https://$AWS_S3_ENDPOINT" s3 ls "s3://$USERNAME/"
```

**Fix**: relaunch the service (gets a fresh token) or re-export credentials
from the Onyxia console → **"My account" → "Connect to storage"**.

## Endpoint without scheme

A URL without `https://` fails for write operations (list may work).
Always use `https://$AWS_S3_ENDPOINT` in every tool configuration.

Wrong: `minio.lab.sspcloud.fr` → fails for writes
Correct: `https://minio.lab.sspcloud.fr`

## R region resolution error

MinIO is S3-compatible but not a real AWS region. In R, always pass
`region = ""` to `aws.s3` and `arrow` functions to avoid spurious
AWS region resolution attempts.

```r
# WRONG — tries to resolve an AWS region that doesn't exist on MinIO
s3read.csv("file.csv", bucket = "mybucket")

# CORRECT
s3read.csv("file.csv", bucket = "mybucket", opts = list(region = ""))
```

## 400 NoSuchBucket

The bucket name is wrong. Verify the actual username (see
[references/env.md](references/env.md)) — `$USERNAME` may not be your
real username in pod contexts.

## References

- Check token expiry: `scripts/check_s3.sh`
- Full variable list: [references/env.md](references/env.md)
