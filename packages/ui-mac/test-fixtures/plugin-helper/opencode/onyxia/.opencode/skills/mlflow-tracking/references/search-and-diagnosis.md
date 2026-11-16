# Comparing runs & diagnosing regressions

## Basic comparison

```python
import mlflow
runs = mlflow.search_runs(
    experiment_names=["project-name"],
    order_by=["metrics.f1 DESC"],
    max_results=10
)
best = runs.iloc[0]
print(best["run_id"], best["metrics.f1"])
```

## SQL-like filtering

```python
runs = mlflow.search_runs(
    experiment_names=["project-name"],
    filter_string="status = 'FINISHED' and params.model_type = 'rf' and metrics.f1 > 0.8",
)
```

Excluded statuses (`FAILED`, `KILLED`) are not in the default search —
explicitly filter for them if needed.

## What changed between best and worst?

```python
import mlflow
runs = mlflow.search_runs(experiment_names=["project-name"],
                          order_by=["metrics.f1 DESC"])
best, worst = runs.iloc[0], runs.iloc[-1]

param_cols = [c for c in runs.columns if c.startswith("params.")]
diverging = {c: (best[c], worst[c]) for c in param_cols if best[c] != worst[c]}
print(diverging)
```

## Diagnosis reflexes when a metric regresses

| Observation | Suspect |
|---|---|
| Same params but worse metric | **Data changed** — log S3 path + hash |
| Metric suspiciously perfect (~1.0) | Target leakage in features |
| Runs missing from comparison | Check status — `FAILED`/`KILLED` excluded by filter |
| Better metric but worse on validation | Overfitting — check CV, not just train score |
