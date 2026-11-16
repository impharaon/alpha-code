# Environment: uv setup

`uv` is the recommended manager (deterministic lockfile, fast).

## Init

```bash
uv init my-project && cd my-project
```

## Add packages

```bash
# Runtime — data science stack
uv add polars pandas pyarrow duckdb scikit-learn mlflow s3fs

# Dev tooling
uv add --dev ruff pytest mypy
```

## Run

```bash
uv run python scripts/train.py
```

## Sync from lockfile

```bash
uv sync     # rebuilds the env from uv.lock (reproducible)
```

`pyproject.toml` + `uv.lock` are committed; never the `.venv/`.

## Dependency groups

For Quarto rendering, keep rendering tooling in a `doc` group:

```bash
uv add --group doc jupyter nbclient ipykernel tabulate
```

See also [references/structure.md](structure.md) for project layout.
