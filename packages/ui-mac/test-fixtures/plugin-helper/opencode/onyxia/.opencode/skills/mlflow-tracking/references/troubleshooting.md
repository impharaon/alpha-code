# Troubleshooting MLflow

## `MLFLOW_TRACKING_URI` missing or `null`

The MLflow service was not running when the current service was created.
The tracking URI is injected at service creation time, not retroactively.

**Fix**: launch MLflow from the catalog → restart the target service
(MLflow URL is of the form `https://user-<namespace>-<id>.user.lab.sspcloud.fr`).

Alternative: point manually:
```python
import mlflow
mlflow.set_tracking_uri("https://user-<namespace>-<id>.user.lab.sspcloud.fr")
```

## `403 AccessDenied` when writing an artifact

Expired 7-day S3 token. Same as any S3 403: relaunch the service
(see `onyxia-storage-s3` skill).

## Runs not appearing in `search_runs`

`search_runs` excludes `FAILED` and `KILLED` runs by default.
To see them:
```python
runs = mlflow.search_runs(experiment_names=["project-name"],
                          filter_string="status in ('FAILED', 'KILLED')")
```

## `model:latest` not found

The model hasn't been registered or promoted yet. Check:
```python
from mlflow import MlflowClient
client = MlflowClient()
client.search_registered_models("name = 'my_model'")
```

## References

- check_s3.sh for S3 token diagnostics
- `onyxia-storage-s3` skill for token renewal
