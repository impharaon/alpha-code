# Logging patterns: manual + autolog

## Manual logging

```python
import mlflow
from mlflow.models import infer_signature

with mlflow.start_run(run_name="rf-baseline"):
    mlflow.log_params({"n_estimators": 200, "max_depth": 8})
    model.fit(X_train, y_train)
    mlflow.log_metric("f1", f1_score)
    mlflow.log_metric("roc_auc", auc)
    mlflow.sklearn.log_model(
        model, artifact_path="model",
        registered_model_name="my_model",
        signature=infer_signature(X_train, model.predict(X_train)),
        input_example=X_train.head(3)
    )
    mlflow.log_artifact("figures/confusion_matrix.png")
```

## Autolog (simplest)

```python
import mlflow
mlflow.sklearn.autolog()      # or xgboost / lightgbm / pytorch / keras
mlflow.set_experiment("project-name")
with mlflow.start_run():
    model.fit(X_train, y_train)   # params, metrics, model logged automatically
```

## What to log systematically

- Code version (Git commit)
- Dataset (S3 path + optional hash)
- Seed, environment (`uv.lock`/`renv.lock`)
- Script parameters (arguments, config file)

## Signature + input_example

Always provide `signature` and `input_example` to `log_model`: the input
schema is then validated at load/serving time.
