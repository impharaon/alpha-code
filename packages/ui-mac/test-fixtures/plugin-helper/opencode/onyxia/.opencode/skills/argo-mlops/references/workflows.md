# Argo Workflows: parallel training and scheduled pipelines

## Parallelizing a hyperparameter search

Create independent processes, one per hyperparameter combination; each one
trains the model then logs to MLflow. `withItems` skeleton:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Workflow
metadata:
  generateName: hp-search-
spec:
  entrypoint: grid
  arguments:
    parameters:
      - name: experiment
        value: "my-project"
  templates:
    - name: grid
      steps:
        - - name: train
            template: train
            arguments:
              parameters: [{name: max_depth, value: "{{item.max_depth}}"},
                           {name: lr, value: "{{item.lr}}"}]
            withItems:
              - { max_depth: "4",  lr: "0.1" }
              - { max_depth: "8",  lr: "0.1" }
              - { max_depth: "8",  lr: "0.05" }
              - { max_depth: "12", lr: "0.05" }
    - name: train
      inputs:
        parameters: [{name: max_depth}, {name: lr}]
      container:
        image: inseefrlab/<project-image>:main      # image containing the code + deps
        command: ["python", "train.py"]
        args: ["--max-depth", "{{inputs.parameters.max_depth}}",
               "--lr", "{{inputs.parameters.lr}}",
               "--experiment", "{{workflow.parameters.experiment}}"]
        env:
          # auto-generated URL of the MLflow catalog service (= $MLFLOW_TRACKING_URI)
          - { name: MLFLOW_TRACKING_URI, value: "https://user-<namespace>-<id>.user.lab.sspcloud.fr" }
          # S3/MLflow secrets come from a mounted Secret, never from plain-text YAML
```

Each container logs its run to MLflow; you then compare the runs in the
MLflow UI.

## Submitting and following a workflow

`argo submit` launches containers on the cluster — confirm with the user first.

```bash
argo submit workflow.yml --watch      # submit and follow the execution
argo list                             # running / finished workflows
argo logs @latest -f                  # logs of the latest workflow
# alternative without the argo CLI: kubectl create -f workflow.yml
# (create, NOT apply: `generateName` is incompatible with apply)
```

## Packaging the training code

- A parameterized script (`train.py` / `train.R`) that reads its data from
  S3 (skill `onyxia-storage-s3`) and logs to MLflow (skill `mlflow-tracking`).
- A `Dockerfile` starting from an Insee base image
  (e.g. `inseefrlab/python-datascience`). The image is (re)built by CI
  (GitHub Actions) and published.
- The Argo workflow references this image → frozen, replayable environment.

## Scheduled pipelines: CronWorkflow

A **`CronWorkflow`** has the same spec as a `Workflow`, wrapped in
`workflowSpec`, plus a cron `schedule` field. Typical use: a scheduled ETL
that collects the business logs exposed by a prediction API and stores them
as Parquet on S3 (see [argocd.md](argocd.md) for the monitoring side).

```yaml
apiVersion: argoproj.io/v1alpha1
kind: CronWorkflow
metadata:
  name: api-logs-etl
spec:
  schedule: "0 6 * * *"           # every day at 06:00
  concurrencyPolicy: Forbid       # do not overlap runs
  workflowSpec:                   # = the spec of a regular Workflow
    entrypoint: etl
    templates:
      - name: etl
        container:
          image: inseefrlab/<project-image>:main
          command: ["python", "collect_logs.py"]
          args: ["--output", "s3://<bucket>/logs/{{workflow.creationTimestamp.Y}}-{{workflow.creationTimestamp.m}}-{{workflow.creationTimestamp.d}}.parquet"]
          # S3 credentials from a mounted Secret, not plain-text YAML
```

```bash
kubectl create -f cronworkflow.yml    # create, not apply
argo cron list                        # list scheduled workflows
```

## Guardrails

- Never a plain-text secret in YAML: use K8s `Secret`s / Vault.
- Minimal container per step (only what is needed) = reproducibility.
- Always keep the trace: Git commit, data (S3 path + hash), MLflow run,
  deployed version.
