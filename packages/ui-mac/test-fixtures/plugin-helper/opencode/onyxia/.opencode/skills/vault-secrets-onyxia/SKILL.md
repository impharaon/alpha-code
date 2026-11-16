---
name: vault-secrets-onyxia
description: Manage secrets (API keys, passwords, tokens) with Vault on Onyxia/SSP Cloud — "My secrets" tab, vault kv CLI, automatic injection of secrets as environment variables at service creation, reading from Python/R. Load whenever a task involves a secret, an API key, a password, a token, a .env file, or when a credential risks being hard-coded. (keywords: secrets, clé d'API, mot de passe, jeton, coffre-fort)
license: MIT
---

# Managing secrets with Vault on Onyxia

Onyxia provides a per-user **Vault** secret store, managed from the
**"Mes secrets"** (My secrets) tab of the datalab or via the CLI. It is THE mechanism
to avoid any hard-coded credential.

> **Golden rule**: a secret is never **committed**, never **logged**,
> never written in a notebook, a YAML file or a Quarto render. It always
> arrives through an **environment variable**.

## Injected environment variables
| Variable | Role |
|---|---|
| `VAULT_ADDR` | Vault server URL |
| `VAULT_TOKEN` | authentication token (temporary) |
| `VAULT_MOUNT` | KV mount point (e.g. `onyxia-kv`) |
| `VAULT_TOP_DIR` | root folder of your secrets (= your username) |

## Create / read a secret

**UI**: "Mes secrets" → new secret → key/value pairs
(e.g. secret `api-insee` with keys `CLIENT_ID`, `CLIENT_SECRET`).

**Terminal — vault CLI**:
```bash
vault kv list "$VAULT_MOUNT/$VAULT_TOP_DIR"                     # list
vault kv get  "$VAULT_MOUNT/$VAULT_TOP_DIR/api-insee"           # read
vault kv put  "$VAULT_MOUNT/$VAULT_TOP_DIR/api-insee" \
  CLIENT_ID="xxx" CLIENT_SECRET="yyy"                           # write
vault kv get -field=CLIENT_SECRET \
  "$VAULT_MOUNT/$VAULT_TOP_DIR/api-insee"                       # a single key
```

## Inject a secret into a service
When creating an Onyxia service: configuration → **Vault** → enter the
secret's path (e.g. `api-insee`). Each key of the secret then becomes an
**environment variable** of the service (`CLIENT_ID`, `CLIENT_SECRET`, …).

## Read in code (never the hard-coded value)
```python
import os
client_secret = os.environ["CLIENT_SECRET"]
```
```r
client_secret <- Sys.getenv("CLIENT_SECRET")
```
For local dev without injection: an **uncommitted** `.env` file (listed in
`.gitignore`, `git-workflow-ds` skill) loaded via `python-dotenv` / R `dotenv`.

## Troubleshooting / common errors
- `403 permission denied` (Vault) → `VAULT_TOKEN` expired: relaunch a service
  (new token) or re-authenticate.
- `No value found at ...` → wrong path: check `VAULT_MOUNT` and
  `VAULT_TOP_DIR` (`vault kv list` to explore).
- The variable does not appear in the service → the secret's path was not
  entered at service creation (injection is not retroactive).

## If a secret has leaked (committed, logged, published)
1. **Revoke / rotate** the secret immediately (purging history is
   never enough: consider the secret compromised).
2. Purge the Git history if needed (`git filter-repo`, `git-workflow-ds` skill).
3. Recreate the secret in Vault and re-inject it.

## References
- docs.sspcloud.fr (secrets section)
- https://developer.hashicorp.com/vault/docs/commands/kv
