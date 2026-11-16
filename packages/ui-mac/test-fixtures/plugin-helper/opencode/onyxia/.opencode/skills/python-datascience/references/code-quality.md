# Code quality gate

Run these **before every commit**:

```bash
uv run ruff format .            # formatting (enforces style)
uv run ruff check --fix .       # lint + safe automated fixes
uv run pytest -q                # tests (exit non-zero on failure)
uv run mypy src/                # gradual typing
```

## Ruff conventions

- Use `# noqa` sparingly and with a reason
- `ruff format` is non-interactive — it fixes everything, no `--select` needed
- Prefer functions (`module::function` style) over inline scripts

## pytest conventions

- Tests live in `tests/`
- Name test files `test_*.py`, test functions `test_*`
- Use `assert` — no need for `self.assertEqual`
- Parametrize with `@pytest.mark.parametrize` for multiple inputs

## Typical quality check

```bash
uv run ruff format . && uv run ruff check . && uv run pytest -q && uv run mypy src/
echo $?   # 0 = all green
```
