# Serving a model — FastAPI

Expose predictions through a **FastAPI** API (loaded from the MLflow registry),
then containerize and deploy (`argo-mlops` skill).

## Minimal FastAPI serving

```python
from fastapi import FastAPI
import mlflow.pyfunc

app = FastAPI()
model = mlflow.pyfunc.load_model("models:/my_model@production")

@app.post("/predict")
async def predict(data: dict):
    import pandas as pd
    df = pd.DataFrame([data])
    return {"prediction": model.predict(df).tolist()}
```

## Containerize

```dockerfile
FROM inseefrlab/python-datascience:latest
COPY . /app
WORKDIR /app
EXPOSE 8080
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]
```

## Deploy

1. Build image → push to a registry
2. Deploy via ArgoCD (GitOps) or manual `kubectl apply`
3. Health check endpoint at `/health`

See `argo-mlops` skill for full deployment workflow.
