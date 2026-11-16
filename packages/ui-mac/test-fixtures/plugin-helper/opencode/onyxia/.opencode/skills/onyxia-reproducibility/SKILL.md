---
name: onyxia-reproducibility
description: Reproducibility and portability best practices for a data science project on Onyxia/SSP Cloud — project structure, containerization (Dockerfile from the Insee images), lockfiles, parameterization, secret management with Vault, publishing with Quarto, Git workflow. Load to frame a project's structure, make it reproducible, or prepare it for scaling up/production. (keywords: reproductibilité, portabilité, conteneurisation, mise en production, structure de projet)
license: MIT
---

# Reproducibility & portability on Onyxia

Goal: a project that can be replayed identically by a third party, on another
service, without manual configuration. It is the prerequisite for any move to production.

## The four pillars
1. **Code under Git** — all the code, nothing but the code (no data, no
   secrets); `.gitignore`, commits and PRs: `git-workflow-ds` skill.
2. **Pinned environment** — `uv.lock` (Python) or `renv.lock` (R) committed;
   ideally a `Dockerfile` to pin the system too.
3. **Externalized data** — on S3/MinIO, never in the repository; paths
   parameterized (config), not hard-coded (`onyxia-storage-s3` skill).
4. **Declarative execution** — a pipeline (`targets` in R, or Argo orchestration)
   rather than a series of notebook cells to run in the right order.

## Containerization
Start from a base image in the Insee catalog, which already contains R/Python
and data science tooling preconfigured for S3:
```dockerfile
FROM inseefrlab/python-datascience:latest
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen
COPY . .
CMD ["uv", "run", "python", "scripts/train.py"]
```
The image is rebuilt and published by CI (GitHub Actions); it is then
reused by Argo workflows and deployments (`argo-mlops` skill).

## Secrets: never in plain text
Credentials always arrive as environment variables; project-specific
secrets go into **Vault** — details, CLI and injection: `vault-secrets-onyxia`
skill.

## Parameterization
Centralize parameters (S3 paths, hyperparameters, experiment names) in
a configuration file (`conf/config.yaml`) or as command-line arguments.
The same code must run in dev and in prod by changing only the config.

## Publishing — Quarto
Document analyses and results in `.qmd` (executable code versioned with the
report) — writing, rendering and publishing: `quarto-publication` skill.

## Anti-patterns to flag in review
- Monolithic notebook intended for production (extract the logic to `src/`/`R/`).
- Absolute local paths; data in the repository; hard-coded credentials.
- Unpinned environment ("it works on my machine").
- Unscripted manual steps between training and deployment.

## Reference
- Complete guide "Mise en production de projets data science" (putting data
  science projects into production):
  https://ensae-reproductibilite.github.io/website
- R project structure & quality (utilitR, Insee): https://book.utilitr.org
- Onyxia user guide: https://docs.onyxia.sh/user-doc/user-guide
