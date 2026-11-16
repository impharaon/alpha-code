# R — mlflow package

R support is more limited: no autolog, reduced registry API.
For advanced usage, prefer the MLflow UI or a helper Python script.

## Basic logging

```r
library(mlflow)
mlflow_set_experiment("project-name")
with(mlflow_start_run(), {
  mlflow_log_param("alpha", 0.3)
  model <- glmnet(x, y, alpha = 0.3)
  mlflow_log_metric("rmse", rmse)
  mlflow_log_model(model, "model")
})
```

## Comparison from R

Use Python for advanced search/filter — the MLflow UI is the better
interface for R-side exploration.
