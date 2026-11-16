---
name: insee-public-data
description: Find and load French public data — Melodi API (Insee's definitive data catalog), metadata API, s3://donnees-insee/diffusion, data.gouv.fr, pynsee, R insee. Use whenever the user needs external/public data, an Insee dataset, a statistical series, or French administrative reference data. (keywords: données publiques, open data, recensement, communes, code officiel géographique, série, Melodi, métadonnées)
license: MIT
---

# Sourcing French public data (Insee, data.gouv.fr)

Order of preference: **Melodi API** (Insee data + metadata) → **s3://donnees-insee/diffusion** → data.gouv.fr / parquets → pynsee / R insee → CSV download (last resort).

## 1. Melodi API — Insee's reference for data

`https://api.insee.fr/melodi/` is the **canonical** Insee data API.
It follows the DCAT standard: each dataset has an `identifier` (e.g. `DD_CNA_AGREGATS`), distributions (CSV/JSON), and rich metadata (license, frequency, temporal coverage).

### Discover datasets (DCAT catalog)

```python
import requests

r = requests.get("https://api.insee.fr/melodi/catalog/dcat")
datasets = [d for d in r.json()["@graph"] if d.get("@type") == "dcat:Dataset"]
for ds in datasets:
    print(f"{ds['dct:identifier']}: {ds['dct:title']}")
```

```r
library(httr2)
r <- req_perform(req_url("https://api.insee.fr/melodi/catalog/dcat"))
datasets <- resp_body_json(r)[["@graph"]]
datasets <- datasets[which(sapply(datasets, function(d) d[["@type"]] == "dcat:Dataset")), ]
for (ds in datasets) {
  cat(sprintf("%s: %s\n", ds[["dct:identifier"]], ds[["dct:title"]]))
}
```

### Download a specific dataset

Once you know the `identifier` (e.g. `DD_CNA_AGREGATS`), get its CSV distribution:

```python
dataset_id = "DD_CNA_AGREGATS"

# Step 1: find the CSV distribution
r = requests.get(f"https://api.insee.fr/melodi/catalog/dcat")
ds_list = [d for d in r.json()["@graph"] if d.get("@type") == "dcat:Dataset" and d.get("dct:identifier") == dataset_id]
if not ds_list:
    raise ValueError(f"Dataset '{dataset_id}' not found")
dist = [d for d in r.json()["@graph"] if d.get("@type") == "dcat:Distribution" and d.get("dct:identifier") == f"{dataset_id}_CSV_FR"]
url = dist[0]["dcat:downloadURL"]

# Step 2: download and read
import pandas as pd
df = pd.read_csv(url)
```

For a **single-series query** (time-series with filters), Melodi also supports direct CSV URLs:

```
https://api.insee.fr/melodi/file/<IDENTIFIER>/<DISTRIBUTION_ID>
```

> **Note:** Melodi needs an API key from https://portail-api.insee.fr
> (store it in Vault via `vault-secrets-onyxia`; inject as env var;
> pass via `Authorization: Basic <key>` or query param).

## 2. Metadata API — understand the data

`https://api.insee.fr/metadonnees/` complements Melodi by providing the **semantic context**:
definitions, nomenclatures, and geographic hierarchies.

OpenAPI spec: `https://api.insee.fr/metadonnees/openapi.json` (99 endpoints, 4 tags).

| Tag | Role | Example |
|---|---|---|
| **nomenclatures** | Decode official codes (NAF, juridique, etc.) | `GET /codes/nafr2/classe/62.01Z` → "Programmation" |
| **concepts** | Semantic definitions of indicators | `GET /concepts/definitions` → all defined concepts |
| **geographie** | Administrative hierarchy tree | `GET /geo/commune/{code}` → commune info + parents/children |
| **operations** | Survey/collection metadata | `GET /operations` → list of Insee operations |

### Practical examples

**Look up a NAF class code:**
```python
import requests
r = requests.get("https://api.insee.fr/metadonnees/codes/nafr2/classe/62.01Z")
print(r.json())  # → {"id": "62.01Z", "label": "Programmation", ...}
```

**Find all communes in a department:**
```python
r = requests.get("https://api.insee.fr/metadonnees/geo/commune?departement=75")
# Returns list of Paris communes with INSEE codes
```

**Get concept definition (e.g. what does "PIB par habitant" mean?):**
```python
r = requests.get("https://api.insee.fr/metadonnees/concepts/definitions")
# Filter for the indicator you need — labels explain units and methodology
```

Use metadata API **before** downloading from Melodi to understand:
- what each column represents (unit of measure, frequency)
- which geographic codes it uses (commune, IRIS, region…)
- which nomenclatures apply (NAF rév.2, CSP, etc.)

## 3. s3://donnees-insee/diffusion — shared mirrored datasets

Some Insee datasets are already mirrored on the platform's MinIO bucket.
Check before re-downloading:

```bash
aws --endpoint-url "https://$AWS_S3_ENDPOINT" s3 ls s3://donnees-insee/diffusion/
```

When the file is there, read it lazily from S3 (see `onyxia-storage-s3`).

> **Why this before data.gouv.fr?** The `donnees-insee` bucket is Insee's
> internal distribution mirror — it is updated first. If the file is there,
> you save a network hop.

## 4. Parquet-first: query files in place

Several flagship datasets are published as Parquet on data.gouv.fr or
static mirrors. duckdb reads them over HTTPS without downloading:

```sql
INSTALL httpfs; LOAD httpfs;
SELECT dep, count(*) FROM read_parquet('https://<direct-parquet-url>') GROUP BY 1;
```

If several analyses will hit the same file, copy it **once** to your S3 bucket
(`aws s3 cp` / `COPY ... TO 's3://...'`), then work from S3.

## 5. data.gouv.fr — secondary source

- **datagouv MCP server** (`https://mcp.data.gouv.fr/mcp`): pre-declared but
  disabled in `opencode.jsonc`. Enable it per-project (never globally) with an
  `opencode.json` at the repo root:
  ```json
  { "mcp": { "datagouv": { "type": "remote", "url": "https://mcp.data.gouv.fr/mcp", "enabled": true } } }
  ```
  ⚠️ A remote MCP sends conversation context outside the platform — public
  data queries only. Once enabled, use it to search datasets/resources and get
  direct file URLs (prefer resources with `format: parquet`).
- Without MCP: the data.gouv.fr **tabular API** and catalog search
  (`https://www.data.gouv.fr/api/1/datasets/?q=...`) — `curl` requires user
  confirmation, which is expected.
- Insee's own catalog: https://www.insee.fr/fr/statistiques (files) and the
  APIs below.

## 6. Fallback APIs

When you need a quick series without Melodi:

**Python — `pynsee`** (`uv pip install pynsee`):

```python
from pynsee.macrodata import get_series          # BDM macroeconomic series
from pynsee.localdata import get_local_data      # local/communal statistics
from pynsee.geodata import get_geodata           # geographies (Admin Express)
from pynsee.sirene import search_sirene          # SIRENE business register

df = get_series("001769682")                     # e.g. monthly CPI
```

`pynsee` needs an API key from https://portail-api.insee.fr for most modules
(store it in Vault, inject as env var — see `vault-secrets-onyxia`).

**R — `insee` package** (BDM series, no key needed for basic use):

```r
library(insee)
idbank_list <- get_idbank_list("CNA-2014-PIB")   # find series ids
df <- get_insee_idbank("001769682")
```

**Geographic reference (COG — Code officiel géographique)**: in R use
`COGugaison`/`insee`; in Python `pynsee.localdata.get_area_list()`. For
commune boundaries: Admin Express via `get_geodata` or IGN downloads.

## 7. Hygiene

- Record the **exact source URL + retrieval date** in the README or the
  ingestion script; public files move and get revised.
- Don't commit downloaded data (see `git-workflow-ds`); land it on S3 with a
  parameterized path.
- Watch encodings and department codes (`2A`, `2B`, leading zeros): read codes
  as **text**, never integers.
- API keys for Melodi / pynsee → **Vault only**, never in code.
