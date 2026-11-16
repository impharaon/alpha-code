---
name: onyxia-diagnostics
description: Diagnose a misbehaving Onyxia/SSP Cloud service or job — service shown in red, pod CrashLoopBackOff or OOMKilled, S3 returning 403, MLflow unreachable, Argo workflow failed, package/library missing from the image. Ordered runbook using read-only kubectl/argo/aws commands, mapping symptoms to Onyxia-specific causes. Use whenever something on the platform "does not work". (keywords: service en rouge, ne marche plus, diagnostiquer, panne, erreur 403, pod)
license: MIT
---

# Diagnosing an Onyxia service or job

Work the decision tree top-down with **read-only** commands
(`kubectl get/describe/logs/top`, `argo list/get/logs`, `aws s3 ls`). Do not
restart or delete anything until the cause is identified — and ask before any
mutating command.

## 0. Golden shortcuts (check these before anything else)

| Symptom | First hypothesis on Onyxia |
|---|---|
| **403 on S3/MinIO** (any tool) | the 7-day S3 token expired → renew credentials or relaunch the service. Confirm with `scripts/check_s3.sh` from `onyxia-storage-s3`. |
| **Service red in "My services"** | same token expiry, or the pod is not Running (go to §1) |
| **MLflow env vars missing** (`MLFLOW_TRACKING_URI` empty) | no MLflow service was running when this service started → start MLflow, then relaunch this service so the variable is injected |
| **`ModuleNotFoundError` / `there is no package`** | the base image doesn't ship it — install in the session (`uv pip install`, `install.packages`) and pin it in `pyproject.toml`/`renv.lock`; for jobs, bake a custom image (see `onyxia-reproducibility`) |

## 1. Is the pod healthy?

```bash
kubectl get pods                      # look at STATUS and RESTARTS
kubectl describe pod <pod>            # Events section at the bottom = the answer, usually
kubectl logs <pod> --previous         # logs of the crashed container, if it restarted
kubectl top pod <pod>                 # current CPU/memory vs the service's limits
```

Map what you see:

- **OOMKilled** (in `describe`, "Last State: Terminated, Reason: OOMKilled"):
  the service's memory slider was too low for the workload. Short term: sample
  or process lazily with duckdb (see `eda-duckdb`); otherwise relaunch the
  service with more memory. Verify actual usage with `kubectl top pod`.
- **CrashLoopBackOff**: read `kubectl logs <pod> --previous`. Common Onyxia
  cause: a bad init script URL/personal init failing at startup.
- **Pending** + event "Insufficient cpu/memory": the requested resources
  exceed what the cluster can schedule — lower the sliders.
- **ImagePullBackOff**: typo in a custom image name/tag, or private registry.

## 2. Is it Argo (a workflow/job) rather than a service?

```bash
argo list                              # find the workflow and its phase
argo get <workflow>                    # per-step tree: which node failed
argo logs <workflow>                   # or: argo logs <workflow> -c <node>
```

- A step failing with S3 errors → §0 (tokens are injected at **submission**
  time and also expire; long CronWorkflows need credentials from Vault, not
  from the session).
- `withItems` fan-out where only some items fail → inspect one failing node's
  logs; usually a data-dependent error, not an infra one.
- Rejected at submission (`generateName` error) → use `kubectl create`/`argo submit`,
  never `kubectl apply` (see `argo-mlops`).

## 3. Is it the network path (Ingress/URL)?

- Auto-generated URLs look like `https://user-<namespace>-<id>.user.lab.sspcloud.fr`;
  custom ones `https://<name>.lab.sspcloud.fr` require your own `Ingress` with
  that exact hostname (see AGENTS.md). `404`/`503` on a custom URL:
  `kubectl get ingress` and `kubectl describe ingress <name>` — check host and
  service/port mapping; then `kubectl get svc` to confirm the Service selector
  matches the pod labels.
- Works in the pod (`curl localhost:<port>` — ask before running) but not
  outside → Ingress/Service mismatch, not the app.

## 4. Shared services (MLflow, Vault)

- **MLflow unreachable**: is the MLflow service still alive in "My services"?
  `echo $MLFLOW_TRACKING_URI` — if it points to a dead service URL, restart
  MLflow, then restart the client service (the URI is injected at startup).
  Artifact upload failing but runs recording fine → S3 issue, back to §0.
- **Vault 403**: `VAULT_TOKEN` also expires; `vault kv list <mount>/<top_dir>`
  to test; relaunch the service to get a fresh token (see `vault-secrets-onyxia`).

## 5. Report before fixing

Summarize: symptom → evidence (the exact command output line) → cause →
proposed remediation, and whether it is destructive (relaunching a service
loses non-persisted local files — warn about unpushed Git work first,
see `git-workflow-ds`).
