---
name: git-workflow-ds
description: Git workflow for data science projects at Insee — .gitignore suited to DS (data, environments, outputs, .env), atomic commits and clear messages, short-lived branches and merge/pull requests, notebook handling (nbstripout), absolute no-gos (secrets, data, large binaries) and remediation if a secret was committed. Load to initialize a repository, write a commit message, prepare a PR/MR, clean up a history, or configure a .gitignore. (keywords: dépôt, message de commit, branches, nettoyer un historique, notebooks)
license: MIT
---

# Git workflow for data science

Git versions **the code, nothing but the code**: no data, no secrets,
no re-generatable outputs. Reference: the Insee training
"bonnes pratiques Git" (Git best practices) and utilitR.

## Typical `.gitignore` for a data science project
```gitignore
# Data (it lives on S3, onyxia-storage-s3 skill)
data/
*.parquet
*.csv

# Environments (rebuilt from the lockfiles)
.venv/
renv/library/
renv/staging/

# Re-generatable outputs
output/
_targets/
_site/
*.html

# Secrets and local configuration
.env
.Renviron

# Noise
.Rhistory
.RData
.ipynb_checkpoints/
__pycache__/
```
What we DO commit: `pyproject.toml` + `uv.lock`, `renv.lock`,
`conf/config.yaml` (without secrets), the `README.md`.

## Commits
- **Atomic**: one commit = one coherent change (no "misc wip").
- Message in the **imperative**, first line ≤ 72 characters; a light
  Conventional Commits-style convention is appreciated:
  ```
  feat: add partitioned reading of the RP from S3
  fix: fix the train/test split seed
  docs: complete the README (running the pipeline)
  ```
- Commit often; never commit a state that breaks the main pipeline.

## Branches and review
- `main` stays stable/protected; one **short-lived branch per topic**
  (`feat/lecture-s3`, `fix/seed`), merged quickly via merge/pull request.
- Before merging: review the diff (delegate to `@reviewer`), check
  that no data/output file slipped into the diff (`git status`).

## Notebooks
Cell outputs pollute diffs and may contain data:
```bash
uvx nbstripout --install        # Git filter: strips outputs at commit time
```
Or run `scripts/setup-nbstripout.sh` (bundled with this skill): it picks
uv/pipx/pip automatically and installs the filter for the current repo.
Better: production logic moves out of the notebook into `src/` or `R/`
(`python-datascience` / `r-datascience` skills); the notebook stays exploratory.

## Absolute no-gos
- **Secrets** (API key, password, token) — even "temporarily":
  use Vault (`vault-secrets-onyxia` skill).
- **Data**, even small: Git is not data storage → S3.
- **Large binaries** (> a few MB): they stay in the history forever.

## Remediation: a secret was committed
1. **Revoke the secret first** (rotation) — it is compromised as soon as it is
   pushed; purging the history is not enough.
2. Purge the history:
   ```bash
   git filter-repo --invert-paths --path path/to/file
   git push --force-with-lease
   ```
3. Warn co-contributors (their clones still contain the secret) and
   recreate the secret in Vault.

## References
- Insee training: https://inseefrlab.github.io/formation-bonnes-pratiques-git-R
- utilitR, Git chapters: https://book.utilitr.org
- https://github.com/newren/git-filter-repo
