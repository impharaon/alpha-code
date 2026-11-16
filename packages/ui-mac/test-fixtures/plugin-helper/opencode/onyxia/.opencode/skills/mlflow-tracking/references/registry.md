# Model registry: promote and load

## Load by alias/stage

```python
from mlflow import MlflowClient
client = MlflowClient()

# Load a version by alias/stage
model = mlflow.pyfunc.load_model("models:/my_model@production")
preds = model.predict(X_new)
```

## Version explicitly

Version by alias (`@champion`, `@production`) rather than overwriting.
Keep traceability from data → run → deployed model.

## Promotion checklist

Before promoting an alias to a new version:

1. Metrics ≥ current production version on the **same** evaluation data
2. `signature` + `input_example` present (load-time schema validation)
3. Run links back to exact code (Git commit) and data (S3 path/hash)
4. Model loads and predicts in a fresh environment (clean venv)
5. Deployment via GitOps, not a manual copy (`argo-mlops`)
