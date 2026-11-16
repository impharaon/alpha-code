---
name: mlflow-tracking
description: Track experiments and manage models with the shared MLflow instance on Onyxia/SSP Cloud — logging parameters/metrics/artifacts, autolog, run comparison (search_runs), model registry and loading, in Python and R. Load whenever training a model, comparing runs, or when the task mentions tracking, experiment, MLFLOW_TRACKING_URI, registry or model versioning. (keywords: suivi d'expériences, journaliser, registre de modèles, versionnage de modèles)
license: MIT
---

# Experiment tracking with MLflow on Onyxia

Launch MLflow from the catalog; `MLFLOW_TRACKING_URI` and
`MLFLOW_S3_ENDPOINT_URL` are injected automatically. One
experiment per business problem, one run per configuration.

## 1. Logging — manual or autolog

Start every run with:

```python
import mlflow
mlflow.set_experiment("project-name")
```

| Approach | How | See |
|---|---|---|
| Manual logging | `mlflow.log_param()`, `log_metric()` | [references/logging.md](references/logging.md) |
| Autolog | `mlflow.sklearn.autolog()` | [references/logging.md](references/logging.md) |

## 2. Compare runs & diagnose regressions

```python
runs = mlflow.search_runs(experiment_names=["project-name"],
                          order_by=["metrics.f1 DESC"])
best = runs.iloc[0]
```

See [references/search-and-diagnosis.md](references/search-and-diagnosis.md) for
filtering, comparison, diagnosis.

## 3. Registry — promote and load

```python
model = mlflow.pyfunc.load_model("models:/my_model@production")
```

Promotion checklist: metrics ≥ production, signature + input_example present,
run links back to code + data, model loads in clean env, deploy via GitOps
(`argo-mlops`).

See [references/registry.md](references/registry.md) for full workflow.

## 4. R support

R support is limited (no autolog, reduced registry). For advanced usage,
see [references/r.md](references/r.md).

## 5. Common errors

| Symptom | First suspect | See |
|---|---|---|
| `MLFLOW_TRACKING_URI` missing | service not running | [references/troubleshooting.md](references/troubleshooting.md) |
| `403 AccessDenied` on artifact write | expired S3 token | [references/troubleshooting.md](references/troubleshooting.md) |
| Runs missing from search | status = 'FAILED' | — |