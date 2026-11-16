# Recommended project structure

```
my-project/
├── pyproject.toml          # project metadata + dependencies
├── uv.lock                 # deterministic lockfile (commit this!)
├── .gitignore              # .venv/, output/, .env — see git-workflow-ds
├── src/my_project/         # importable code
│   ├── __init__.py
│   ├── data.py             # data loading / transformation
│   ├── features.py         # feature engineering
│   └── model.py            # model training / evaluation
├── scripts/                # parameterized entry points
│   ├── train.py            # python scripts/train.py --config conf/train.yaml
│   └── predict.py
├── tests/                  # pytest tests
│   ├── __init__.py
│   ├── test_data.py
│   └── test_features.py
├── conf/                   # configuration, NO secrets
│   ├── train.yaml
│   └── predict.yaml
└── notebooks/              # exploration ONLY; production logic → src/
```

## Rules

1. **Production logic in `src/`**, not notebooks. Notebooks are for exploration.
2. **Parameters in `conf/*.yaml`**, not in code. Script arguments override config.
3. **Secrets in Vault** (`vault-secrets-onyxia` skill), not in `conf/` or code.
4. **Data on S3** (`onyxia-storage-s3` skill), not in the repo.
5. **Git is the source of truth** for code + config + model registry pointers.
