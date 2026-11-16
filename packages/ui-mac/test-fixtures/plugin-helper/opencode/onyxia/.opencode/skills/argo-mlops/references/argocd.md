# Serving the model and deploying with GitOps / ArgoCD

## Deployment manifest (API serving the model)

Deployment manifest (excerpt), versioned in the repository:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata: { name: codification-api }
spec:
  template:
    spec:
      containers:
        - name: api
          image: inseefrlab/<api-image>:main
          imagePullPolicy: Always
          env:
            - { name: MLFLOW_TRACKING_URI, value: "https://user-<namespace>-<id>.user.lab.sspcloud.fr" }
            - { name: MLFLOW_MODEL_NAME,   value: "my_model" }
            - { name: MLFLOW_MODEL_VERSION, value: "1" }
```

The API loads its model version from the MLflow registry at startup.

## Ingress: exposing the API

Add an `Ingress` exposing the API at
`https://<firstname>-<lastname>-api.lab.sspcloud.fr`: a hostname you
**choose freely** under the `*.lab.sspcloud.fr` wildcard (custom Ingress).
Do not confuse it with the auto-generated
`user-<namespace>-<id>.user.lab.sspcloud.fr` URLs of catalog services.

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: codification-api
spec:
  rules:
    - host: <firstname>-<lastname>-api.lab.sspcloud.fr   # freely chosen hostname
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service: { name: codification-api, port: { number: 80 } }
```

## GitOps with ArgoCD

Commit and push the manifests; **ArgoCD** automatically synchronizes the
cluster to the state of the repository (auto sync in ~5 min, or forced
sync from the ArgoCD UI).

## Beyond deployment: keeping the model in operational condition

- Business logs exposed by the API → scheduled ETL pipeline (an Argo
  **`CronWorkflow`**, see [workflows.md](workflows.md)) that stores them as
  Parquet on S3.
- Dashboard (Quarto Dashboards, Grafana, Superset) to track usage and
  detect data / performance drift.
- Iterate: new model version → new image version → ArgoCD redeploys;
  rollback is possible by pointing back to a previous version.

## Guardrails

- Never a plain-text secret in YAML: use K8s `Secret`s / Vault.
- Always keep the trace: Git commit, data (S3 path + hash), MLflow run,
  deployed version.
