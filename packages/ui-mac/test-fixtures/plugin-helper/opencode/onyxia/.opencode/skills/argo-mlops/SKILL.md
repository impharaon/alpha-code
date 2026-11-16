---
name: argo-mlops
description: Industrialize a model on Onyxia with Argo Workflows (parallel training / distributed hyperparameter search on Kubernetes) and ArgoCD (continuous deployment via GitOps). Load this skill to parallelize training runs, package a model, write an Argo Workflow, deploy a prediction API or put a model into production (industrialiser, entraînement parallèle, workflow, déploiement).
license: MIT
---

# MLOps on Onyxia: Argo Workflows + ArgoCD

Recommended stack:
**MLflow** (tracking/registry) + **Argo Workflows** (parallel orchestration on K8s) +
**ArgoCD** (GitOps deployment). Each workflow step = an isolated container
→ maximum reproducibility.

## When to use Argo (and when not to)

- **A simple sequential script is enough** (one training run, small data):
  do NOT reach for Argo — run the script in the interactive service.
- **Argo Workflows** when you need parallelism (hyperparameter grid, one
  container per combination), scheduled pipelines (`CronWorkflow`), or
  containerized, replayable multi-step pipelines.
- **ArgoCD** when a model/API must live in production: manifests versioned
  in Git, the cluster auto-syncs to the repository state.

## Critical gotchas

- Use **`kubectl create -f workflow.yml`, never `kubectl apply`**: Argo
  Workflows use `generateName`, which is incompatible with `apply`.
- **`argo submit` launches containers on the cluster** (consumes shared
  resources, runs your code remotely) → always ask the user for
  confirmation before submitting.
- Never put a secret in plain text in a YAML manifest: use K8s `Secret`s /
  Vault (skill `vault-secrets-onyxia`).
- Always keep the trace: Git commit, data (S3 path + hash), MLflow run,
  deployed version.

## Typical flow

1. Package a parameterized training script (`train.py` / `train.R`) that
   reads its data from S3 (skill `onyxia-storage-s3`) and logs to MLflow
   (skill `mlflow-tracking`) into a Docker image based on an Insee image
   (e.g. `inseefrlab/python-datascience`), rebuilt by CI.
2. Write a `Workflow` referencing that image; parallelize with `withItems`.
3. Submit (`argo submit workflow.yml --watch`), compare runs in MLflow.
4. Serve the best model as an API, deploy via ArgoCD, monitor.

## Where to look next

| Need | Read |
|---|---|
| Full `Workflow` YAML, `withItems` hyperparameter grid, `argo` CLI commands, `CronWorkflow` (scheduled ETL), packaging details | [references/workflows.md](references/workflows.md) |
| Serving the model (Deployment + Ingress), GitOps with ArgoCD, monitoring and iteration | [references/argocd.md](references/argocd.md) |
| Ready-to-adapt starter Workflow (parameterized training job, S3 artifact output) | [assets/workflow-template.yaml](assets/workflow-template.yaml) |
