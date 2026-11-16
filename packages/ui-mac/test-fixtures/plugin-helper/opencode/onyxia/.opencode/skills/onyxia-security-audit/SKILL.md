---
name: onyxia-security-audit
description: Audit a file, a diff or a whole repository for leaked credentials (AWS AKIA keys, Vault hvs. tokens, GitHub ghp_/github_pat_ tokens, hardcoded passwords and API keys, private keys, a token embedded in a git remote URL), for hardcoded S3/MinIO endpoints, buckets and usernames that should be read from the AWS_* environment variables, and for reproducibility gaps (missing uv.lock/renv.lock, missing .gitignore, unseeded randomness). Load before a commit or a push, for the /check-secrets command, or whenever the user asks to check for secrets, credentials or leaks (keywords: secret, credential, fuite, clé d'API, mot de passe, jeton, audit sécurité, avant de commiter, avant de pousser).
license: MIT
---

# ONYXIA-SECURITY-AUDIT skill — proactive security & reproducibility checks

Run a lightweight security and reproducibility audit on a file or directory.

## What to check

### 1. Secret leakage 🔴
Scan for patterns that look like credentials:
- AWS keys (`AKIA[0-9A-Z]{16}`, `wJalrXUtnFEMI[...]`)
- Vault tokens (`hvs.[a-zA-Z0-9_-]{30,}`)
- Generic API keys / tokens (`api_key`, `apikey`, `token`, `secret`, `password`, `passwd`, `credential`)
- Private SSH keys (`-----BEGIN (RSA |DSA |EC |OPENSSH )?PRIVATE KEY-----`)

**Only flag non-obvious/false positives** (e.g. variable *names* like `my_token` are info, not errors).
Flag values that are hard-coded strings: `password = "mysecretpass"`, `token: sk-abc...`.

### 2. Hardcoded S3 paths / buckets 🔴
Detect raw S3 URLs or bucket names baked into code:
- `s3://user-[^/]+/...` with a literal username instead of `$USERNAME` / `os.environ["USERNAME"]` / `Sys.getenv("USERNAME")`
- Hardcoded MinIO endpoint (`minio.lab.sspcloud.fr`) where `os.environ["AWS_S3_ENDPOINT"]` should be used
- Any absolute path pattern like `/local/path/to/data` that suggests a file was downloaded instead of streamed

### 3. Reproducibility gaps 🟡
- `.gitignore` missing: check project root — warn if absent or if it doesn't cover `.env`, `__pycache__`, `*.Rhistory`, `renv/`, `uv.lock`/`pyproject.toml`
- No `uv.lock` or `renv.lock` for Python / R projects
- Randomness without a fixed seed (`random.seed`, `set.seed`, `np.random.default_rng(seed)`)
- Parameterization: functions that accept file paths should use parameters, not variables named after a specific user/bucket

### 4. Data handling best practices 🟢
- Large CSV/JSON downloaded to disk → suggest `s3fs` / `arrow` / `duckdb` streaming
- No Parquet usage when dealing with >1k rows → suggest Parquet

## How to run

Two things to know before copying these:

- `grep -E` is **POSIX ERE — no PCRE lookaheads.** `s3://(?!VAR)` is a syntax
  error, not a negative match. Invert with a second pass instead.
- `grep --include=… .` needs `-r`, otherwise `.` is just a directory argument.
  Prefer `git grep`, which searches tracked files and needs neither.

```bash
# 1. Credential-shaped literals in tracked files
git grep -nEi \
  -e 'AKIA[0-9A-Z]{16}' \
  -e 'hvs\.[A-Za-z0-9_-]{20,}' \
  -e 'ghp_[A-Za-z0-9]{36}' \
  -e 'github_pat_[A-Za-z0-9_]{20,}' \
  -e '(password|passwd|secret|api[_-]?key|token|credential)[[:space:]]*(=|:|<-)[[:space:]]*.[^"'"'"']{8,}' \
  -e '-----BEGIN [A-Z ]*PRIVATE KEY-----' \
  -- '*.py' '*.R' '*.qmd' '*.Rmd' '*.ipynb' '*.yaml' '*.yml' '*.toml' '*.sh' '*.env*'

# 2. Hardcoded MinIO endpoint or literal bucket — two passes, no lookahead:
#    match the pattern, then drop the lines that DO read from the environment.
git grep -nE 'minio\.lab\.sspcloud\.fr|s3://[a-z0-9][a-z0-9.-]+' -- '*.py' '*.R' '*.qmd' \
  | grep -vE '\$\{?(USERNAME|AWS_S3_ENDPOINT)|os\.environ|getenv|Sys\.getenv'

# 3. Staged changes only (the pre-commit check)
git diff --cached -U0 \
  | grep -nEi 'AKIA[0-9A-Z]{16}|hvs\.|ghp_|(password|secret|token)[[:space:]]*(=|:|<-)'

# 4. Recent history (last 5 commits), patches not commit subjects
git log -p -5 --diff-filter=ACM -- '*.py' '*.R' '*.qmd' '*.yaml' \
  | grep -nEi 'AKIA[0-9A-Z]{16}|hvs\.|ghp_|(password|secret|token)[[:space:]]*(=|:|<-)'

# 5. Token embedded in a remote URL — common on throwaway pods, easy to miss
git remote -v | grep -E 'https://[^@/]+@'

# 6. Reproducibility
ls -1 uv.lock renv.lock .gitignore 2>&1
git grep -nE 'random\.(rand|choice|seed)|np\.random|set\.seed' -- '*.py' '*.R'
```

Every one of these exits **1 when it finds nothing**, which is the good case —
do not report a non-zero exit as a failure.

**Never print a matched secret in full.** Show enough to locate it:
`src/train.py:42  password = "P@ss…"`.

## Output

Return a structured report:

```markdown
## Security & Reproducibility Audit
| # | file | line | category | severity | finding | recommendation |
|---|------|------|----------|----------|---------|----------------|
| 1 | src/train.py | 42 | secret | 🔴 error | Hardcoded password string "P@ssw0rd" | Move to Vault, use os.environ |
...
```

Classify:
- 🔴 **error** — blocks merge (secrets, hardcoded credentials)
- 🟡 **warning** — should fix (reproducibility gaps, missing lockfile)
- 🟢 **info** — nice-to-have (Parquet suggestion, seed recommendation)

If a real secret is found: **revoke/rotate it first**, then purge it from the
history — in that order, because a pushed secret must be assumed compromised.
See the `git-workflow-ds` skill for the purge, and `vault-secrets-onyxia` for
where the value should have lived.
