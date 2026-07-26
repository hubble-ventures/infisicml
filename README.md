# infisicml

Declarative [Infisical](https://infisical.com) secret manifests for monorepos.
Each package declares the secrets it needs in a `secrets.yaml`; infisicml can
then **pull** them, **validate** them, and **diff** the secret surface between
two revisions — with native GitHub Actions support.

```yaml
# apps/payments/secrets.yaml
version: 1
project: acme-payments
secrets:
  - path: /payments/stripe
    keys:
      - STRIPE_SECRET_KEY
      - STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET # alias source → target
  - path: /shared
    keys:
      - DATABASE_URL
```

## Why

| Problem | Without infisicml | With infisicml |
| --- | --- | --- |
| Each app needs a different slice of the vault | Hand-written export commands per app × folder | One committed `secrets.yaml` per package, auto-discovered |
| "Does this app declare a secret it can't get?" | Find out when it crashes at runtime | `infisicml validate --against-vault` in CI |
| "What secrets does this PR add?" | Read the diff by eye, hope you catch it | `infisicml diff` posts the delta on the PR |

## How it works

A manifest compiles **once** into a flat, sorted list of _bindings_
(`path → sourceKey → targetVar`). Every capability is a pure function over that
list:

- **pull** fetches values for the bindings and writes a `.env` file (or exports
  to the job env in CI).
- **validate** checks the bindings — structurally, then against the live vault.
- **diff** set-diffs two binding lists.

`diff` and tier-1 `validate` operate on _declarations only_ — no vault access at
all — so they're fast, offline, and safe to run on untrusted PR branches. The
vault tiers (`--against-vault`, `--check-values`) query Infisical and should run
in a trusted context.

## The three capabilities

### 1. Pull

```bash
infisicml pull                 # all discovered manifests
infisicml pull apps/payments   # one package, by id (its dir relative to root)
infisicml pull --env production --profile deploy
```

Reads each folder once (whole-folder, or only the declared keys with
`fetch: keys`), applies aliases, and writes the resolved values to
`defaults.output` (default `.env.secrets`) next to each manifest. A missing
required key fails the pull; mark expected-absent keys under
`environments.<env>.optional`.

### 2. Validate

Three escalating tiers:

```bash
infisicml validate                  # tier 1 — schema + structure (no network)
infisicml validate --against-vault  # + tier 2 — every declared key exists in the vault
infisicml validate --check-values   # + tier 3 — present-but-empty required keys
```

- **Tier 1** (offline): valid schema, alias syntax, path format, and — the check
  a plain schema misses — **no two keys resolving to the same variable**.
- **Tier 2**: declared keys must exist in the vault; undeclared vault keys are
  reported as drift warnings.
- **Tier 3**: a required key that exists but is empty is an error.

### 3. Diff

```bash
infisicml diff --base origin/main
```

Structural delta of the secret surface between the working tree and a git ref —
added / removed variables and moved sources. Exits non-zero when anything
changed (use `--exit-zero` for an informational run). Ideal for gating PRs.

## Install

```bash
pnpm add -D @hubble-ventures/infisicml
# or: npm install -D @hubble-ventures/infisicml
# or: yarn add -D @hubble-ventures/infisicml
```

Requires Node ≥ 22 (built and tested on the two most recent LTS lines, 22 and
24). For local use, authenticate with an Infisical token:

```bash
export INFISICAL_TOKEN=...            # a machine-identity or user token
export INFISICAL_API_URL=...          # optional, defaults to https://app.infisical.com
infisicml pull
```

## GitHub Actions

The action authenticates with **GitHub OIDC** — no long-lived credential in the
repo. The calling job sets `permissions: id-token: write`, and an Infisical
machine identity is bound to the GitHub OIDC auth method.

### Pull secrets into the job

```yaml
permissions:
  id-token: write
  contents: read
steps:
  - uses: actions/checkout@v4
  - uses: hubble-ventures/infisicml/action@v3
    with:
      command: pull
      environment: production
      identity-id: ${{ vars.INFISICAL_IDENTITY_ID }}
  # subsequent steps see the secrets as (masked) env vars
```

### Validate + diff on every PR

```yaml
permissions:
  contents: read
  pull-requests: write
steps:
  - uses: actions/checkout@v4
    with: { fetch-depth: 0 } # diff needs the base ref
  - uses: hubble-ventures/infisicml/action@v3
    with: { command: validate }
  - uses: hubble-ventures/infisicml/action@v3
    with:
      command: diff
      base: ${{ github.event.pull_request.base.ref }}
      comment: true # sticky PR comment with the delta
      fail-on-change: true # require review when the surface changes
```

See [`examples/`](examples) for a full manifest and workflow.

## Migrating from v2

v2 used a nested folder tree; v3 uses flat `{ path, keys }` blocks. A codemod
converts manifests in place:

```bash
infisicml migrate --project <slug>           # dry run — preview the v3 YAML
infisicml migrate --project <slug> --write    # apply
```

It flattens the tree, preserves aliases, moves `output`/`fetch` under `defaults`,
renames `optionalKeys` → `optional`, and validates the result before writing.
`project` is passed on the CLI because v2 manifests didn't carry it. The `ci`
block has no v3 equivalent and is dropped with a warning.

## Manifest reference

| Field | Meaning |
| --- | --- |
| `version` | Manifest format version (`1`). |
| `project` | Infisical project slug the secrets live in. |
| `defaults.environment` | Default environment (else `development`). |
| `defaults.output` | Output filename, bare (default `.env.secrets`), written next to the manifest. |
| `defaults.fetch` | `folder` (whole-folder read + local select) or `keys` (per-key least-privilege read). |
| `secrets[]` | Ordered `{ path, keys }` blocks. A key is a bare name or a single-pair `{ SOURCE: TARGET }` alias. |
| `profiles.<name>` | Alternate `secrets`/`fetch` selected with `--profile`. |
| `environments.<env>.optional` | Keys allowed to be absent in that environment. |

A JSON Schema is published at
[`@hubble-ventures/infisicml/schema`](schema/secrets.schema.json); reference it
from a manifest for editor autocomplete:

```yaml
# yaml-language-server: $schema=https://unpkg.com/@hubble-ventures/infisicml/schema/secrets.schema.json
```

## Library

The core and adapters are exported for embedding:

```ts
import {
  compile,
  diffCompiled,
  validateStructure,
  InfisicalProvider,
} from "@hubble-ventures/infisicml";
```

## Architecture

```
src/
  core/       schema · compile (IR) · materialize · validate · diff   (pure, no I/O)
  adapters/   infisical (OIDC + fetch) · workspace (fs/git) · gha
  commands/   resolve · validate · diff                               (shared by CLI + action)
  cli.ts · action.ts · index.ts
```

The pure core holds the logic; adapters are the only place I/O and secret
_values_ live. That's what keeps `validate`/`diff` value-free and the whole core
unit-testable without a network.

## Developing

```bash
pnpm install
pnpm check    # gen:schema + typecheck + test + build
pnpm smoke    # build, then exercise the CLI end-to-end offline
```

`action/index.cjs` (the bundled Action) and `schema/secrets.schema.json` are
committed and verified in CI; run `pnpm build` and commit if you change source.

## Releasing

Releases are automatic: merge a PR that bumps `version` in `package.json` and
the release workflow tags it and publishes to npm via **trusted publishing**
(OIDC, provenance attached) — no `NPM_TOKEN`. It also moves the floating major
tag (e.g. `v3`) so `hubble-ventures/infisicml/action@v3` tracks the latest.

## License

MIT
