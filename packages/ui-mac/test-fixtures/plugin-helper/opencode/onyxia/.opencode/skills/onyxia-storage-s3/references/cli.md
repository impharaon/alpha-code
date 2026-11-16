# CLI recipes — S3/MinIO on Onyxia

## aws s3 (preferred CLI)

The `aws` CLI reads the `AWS_*` variables automatically; you only need to
point it at the MinIO endpoint.

```bash
aws --endpoint-url "https://$AWS_S3_ENDPOINT" s3 ls "s3://$USERNAME/diffusion/"
aws --endpoint-url "https://$AWS_S3_ENDPOINT" s3 cp ./file.parquet "s3://$USERNAME/data/"
aws --endpoint-url "https://$AWS_S3_ENDPOINT" s3 sync ./local_dir "s3://$USERNAME/data/dir"
```

Tip: export `AWS_ENDPOINT_URL="https://$AWS_S3_ENDPOINT"` once to avoid
repeating `--endpoint-url`:

```bash
export AWS_ENDPOINT_URL="https://$AWS_S3_ENDPOINT"
aws s3 ls "s3://$USERNAME/"
```

## mc (MinIO client, alternative)

The `mc` client is also available on the platform, preconfigured with an
`s3` alias pointing at the datalab's MinIO — but `aws s3` is preferred.

```bash
mc ls "s3/$USERNAME/diffusion/"
mc cp ./file.parquet "s3/$USERNAME/data/"
mc mirror ./local_dir "s3/$USERNAME/data/dir"
```

Remember: only copy files locally when a tool truly requires a file on
disk — otherwise read directly from S3 in memory (see the Python and R
recipes).
