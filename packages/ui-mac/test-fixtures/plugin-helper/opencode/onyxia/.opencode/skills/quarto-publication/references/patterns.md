# Patterns: figures, values, tables

## Embedding a figure

```python
#| echo: false
#| fig-cap: "Distribution of income by age group"
import matplotlib.pyplot as plt
plt.hist(df["income"], bins=50)
plt.show()
```

No need to save then reference `![](path.png)` — the `{python}` cell
emits the figure automatically. Add `#| fig-cap:` for the caption.

## Injecting a computed value into prose

```python
#| echo: false
median_income = round(df["income"].median(), 1)
```

In the prose paragraph just before the code cell:

```
The median monthly income is `` `{python} f"{median_income:.1f}"` `` euros.
```

## Tables in Markdown output

```python
#| echo: false
print(df.head(20).to_markdown(index=False, tablefmt="grid"))
```

Requires `tabulate` in the environment (add via `uv add tabulate`).

## Freezing expensive cells

Add to the `.qmd` header or `_quarto.yml`:

```yaml
execute:
  freeze: auto        # freezes results of unmodified chunks
```

This avoids re-running expensive data loading cells when only prose changed.

## Migrating an .Rmd → .qmd

1. Rename `.Rmd` → `.qmd`.
2. Convert `#| results: asis` (knitr) → `#| output: asis` (Jupyter).
3. Convert `@var` inline R → `` `{r} var` `` inline.
4. R code blocks stay as `r`, Python blocks become `python`.
