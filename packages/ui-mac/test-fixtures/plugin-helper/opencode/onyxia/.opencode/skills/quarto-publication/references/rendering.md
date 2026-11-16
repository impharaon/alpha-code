# Rendering pitfalls on Onyxia

These are the traps that make a render fail on the platform.

## 1. Render inside the project env

**Python**: `uv run quarto render report.qmd` — a bare `quarto render`
uses `/opt/python`, not `.venv`, and fails with "unactivated Python
environment in .venv".

**Belt-and-suspenders**: keep an `assets/_environment` file
(`QUARTO_PYTHON=.venv/bin/python`) at the project root — Quarto reads
`_environment` only inside a project — but `uv run` is the reliable habit.

**R**: render from the `renv`-activated session.

## 2. The env must contain the render toolchain

Quarto needs `jupyter`, `nbclient`, `ipykernel` to execute cells and
`tabulate` for `df.to_markdown()`. These live in the project's `doc`
dependency group — never assume the system Python has them.

```bash
uv add --group doc jupyter nbclient ipykernel tabulate
```

## 3. Cell options are Jupyter dialect, not knitr

Use **`#| echo: false`**, **`#| output: asis`**,
**`#| fig-cap:`**.

NOT `#| results: asis` — that is knitr/R, not Quarto/Python.

## 4. Figures

Draw in a `{python}` cell and let the cell emit the figure automatically
(add `#| fig-cap:` for the caption).

**Never** use `IPython.display.Image` to embed a static image — it does
not render in Quarto HTML output.

## 5. Injecting computed values into prose

```python
# In prose, inline:
The median is `` `{python} f"{median:.1f}"` `` euros.
```

NOT:
- `{value}` as literal text — that is not Quarto inline
- `quarto.doc.variables(...)` — it does not exist
- `@value` — not Quarto's syntax
- `pip install quarto` or `pip install quartodoc` — unrelated PyPI packages
