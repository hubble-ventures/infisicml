# Changelog

All notable changes to `infisicml` are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.0.1] - 2026-07-26

Follow-up hardening from post-merge review of #12. No behavior change to the
happy path; the manifest format, CLI, and Action interface are unchanged.

### Fixed

- **diff** now rejects an unknown `--base` ref up front instead of silently
  reporting every manifest as newly added.
- **pull** tightens an already-existing output file to `0600` (not only on
  creation), so a previously world-readable `.env.secrets` is locked down.
- **migrate** dry-run wording no longer claims it "wrote" a file it didn't;
  the message reflects the mode.

### Changed

- Renamed the Action's `packages` output to **`manifests`** for naming
  consistency (the v2 `package-id` vocabulary is gone). ⚠️ If you consumed the
  `packages` output, update to `manifests`.
- CI/release drift gate also asserts `action/index.cjs` and the JSON schema are
  **tracked**, not just diff-clean (a plain `git diff` ignores an untracked
  file).
- `persist-credentials: false` on the release guard checkout (it never pushes).
- README: install snippet shows separate npm/pnpm/yarn commands.

## [3.0.0] - 2026-07-26

Complete rewrite around a pure functional core and three first-class
capabilities: **pull**, **validate**, and **diff**. This is a breaking release —
the manifest format, the CLI, and the GitHub Action all changed.

### Added

- **`diff` — secret-surface diffing for PRs.** `infisicml diff --base <ref>`
  computes the structural delta (added / removed variables, moved sources)
  between the working tree and a git ref, and exits non-zero when anything
  changed. The Action posts it as a sticky PR comment and job summary. It reads
  **declarations only** — never secret values — so it's safe on untrusted
  branches.
- **Tiered `validate`.** Tier 1 is schema + structure (offline), including a
  **duplicate-target-variable** check a plain schema misses. `--against-vault`
  adds tier 2 (every declared key exists in the vault; undeclared keys reported
  as drift). `--check-values` adds tier 3 (present-but-empty required keys).
- **Native JS GitHub Action** (`runs.using: node24`) with a single committed
  bundle — masks every value before it reaches `$GITHUB_ENV`, sets step outputs,
  writes the job summary, and upserts a PR comment. One `command:` input selects
  `pull` / `validate` / `diff`.
- **Published JSON Schema**, generated from the Zod schema so the two can never
  drift, for editor autocomplete.

### Changed

- **New manifest format (`version: 1`).** Flat, diff-friendly `secrets: [{ path,
  keys }]` blocks replace the nested folder tree; `keys` are bare names or
  single-pair `{ SOURCE: TARGET }` aliases. `project` now lives in the manifest.
- **Convention-based discovery.** Packages are found by walking for
  `secrets.yaml` / `secrets.yml`; the separate `infisicml.config` registry is
  gone. Two manifest files in one directory remains a hard error.
- **OIDC-only auth** for the Action, via an Infisical machine identity. No
  long-lived credential in the repo.
- **Toolchain:** ESM-only, `engines: node >= 22` (the two current LTS lines, 22
  and 24). Zod 4 (native JSON-Schema generation), TypeScript 7, Vitest 4, tsup.
  pnpm for development; the published package stays manager-agnostic (CI proves
  install under npm / pnpm / yarn).

### Removed

- The `export-gha`, `list`, `paths`, and `run` subcommands, the
  `infisicml.config.{ts,js,json}` registry, JSON manifests as a first-class
  format, and the CI-stub/skip machinery. The composite (npx) Action is replaced
  by the bundled JS Action.

### Migration

Run the built-in codemod to convert v2 manifests in place:

```bash
infisicml migrate --project <slug>          # dry run — preview the v3 YAML
infisicml migrate --project <slug> --write   # apply
```

It flattens the v2 folder tree into `{ path, keys }` blocks, preserves aliases,
moves `output`/`fetch` under `defaults`, renames `optionalKeys` → `optional`, and
validates the result against the v3 schema before writing. The `project` slug is
supplied on the command line because v2 manifests didn't carry it (it lived in
`infisicml.config` / the action inputs). The `ci` block has no v3 equivalent and
is dropped with a warning. Finally, switch workflows to `command: pull` with
`identity-id`.

## [2.1.0] - 2026-07-18

### Added

- **YAML manifests, as the primary format.** Each package's manifest may now be
  `secrets.yaml`, `secrets.yml`, or `secrets.json` — the same schema either way.
  YAML is the default and reads best for hand-authored manifests; JSON stays
  fully supported (handy for generated manifests). Discovery prefers YAML, but a
  directory containing **more than one** manifest file is a **hard error** rather
  than a silent pick — a stale extra manifest must never change which secret tree
  a non-interactive lane (`export-gha` → `GITHUB_ENV`) writes. No migration is
  required — existing `secrets.json` files keep working unchanged.

  ```yaml
  # secrets.yaml
  secrets:
    - clerk:
        - CLERK_PUBLISHABLE_KEY: VITE_CLERK_PUBLISHABLE_KEY
    - posthog:
        - POSTHOG_PROJECT_TOKEN
  ```

  The ambiguity error is **scoped to the package actually being loaded**:
  discovery now enumerates packages without parsing them, so a single ambiguous
  (or invalid) directory no longer aborts commands that don't touch it — `pull web`
  or `paths web` succeed even if an unrelated `apps/legacy/` holds two manifests;
  only a command that loads that package (`pull legacy`, `pull` with no ids,
  `list`, `validate`) surfaces the error.

  New public API: `findManifestFile`, `hasManifestFile`, `loadManifestFromDir`,
  `parseManifestFile`, `MANIFEST_FILENAMES`, the `ManifestFile` / `ManifestFormat`
  types, plus `discoverPackages` / `loadPackage` and the `PackageRef` type for
  two-phase (enumerate-then-load) discovery. A discovered `PackageManifest` now
  carries the `file` it was loaded from.

## [2.0.0] - 2026-07-17

### Changed (breaking — manifest format)

- **The manifest is now a `secrets` array of folders.** The flat `paths` +
  `include` + `aliases` trio is replaced by a single `secrets` array that mirrors
  your Infisical structure. Each of the three old fields was really an attribute
  of a specific `(folder, key)` pair; the tree binds them together, so a key's
  allowlist membership and its alias live in one place, provenance is explicit,
  and the manifest reads like the vault. `secrets` is an array of folder objects
  `{ name: [ ...contents ] }`; inside a folder's array, a **bare string** is a
  plain key, an object with a **string value** `{ SOURCE: "TARGET" }` is an
  alias, and an object with an **array value** `{ sub: [ ... ] }` is a **real
  subfolder** (nesting mirrors the vault tree — `sub` under `posthog` reads
  `/posthog/sub`). Value type discriminates alias vs subfolder, so subfolders
  need no leading `/`. Fan a key out to several targets by repeating the alias,
  one target each.

  ```jsonc
  // before (v1)                          // after (v2)
  {                                       {
    "paths": ["posthog"],                   "secrets": [
    "aliases": {                              { "posthog": [
      "POSTHOG_PROJECT_TOKEN":                  { "POSTHOG_PROJECT_TOKEN": "VITE_POSTHOG_KEY" }
        "VITE_POSTHOG_KEY"                    ] }
    },                                      ]
    "include": ["POSTHOG_PROJECT_TOKEN"]  }
  }
  ```

- **Default-deny everywhere.** There is no wildcard: every emitted key must be
  named, and an empty folder array is a schema error. The tree *is* the
  allowlist, so the separate `include` field is **removed** — a folder emits
  exactly the keys it declares, from that folder (provenance-aware selection).
- **`fetch: "keys"` no longer needs an allowlist.** Because the tree always
  names every canonical key (an alias entry's key *is* the real vault key),
  key mode requests those names directly — the v1 reverse-mapping from alias
  target to source is gone, and `keys` is always satisfiable. The
  `fetch`-requires-`include` cross-check is removed.
- **Optional keys stay env-scoped** via `environments.<slug>.optionalKeys`
  (unchanged), now referencing declared canonical key names.
- **Profiles** carry an alternate `secrets` array (replacing the base tree when
  `--profile` is set) plus an optional `fetch`; `profiles.<name>.paths` /
  `.include` are gone.
- **Programmatic API.** `resolvePaths` / `resolveInclude` / `applyInclude` /
  `resolveFetchKeys` / `checkFetchIncludeConsistency` / `fetchManifestSecrets` /
  `selectEmittedSecrets` are replaced by `resolveCompiledFolders`, `compileTree`,
  `fetchCompiledFolders`, and `materializeSecrets` (the latter applies aliases
  and enforces missing keys **per folder**, before merging, so a key name shared
  across folders keeps each folder's value and miss); `enforceIncludeKnown` is
  renamed `enforceKnownKeys`. New exports: `compileTree`, `treeSchema`,
  `materializeSecrets`, and the `CompiledFolder` / `CompiledKey` / `FolderEntry` /
  `FolderArray` / `SecretsTree` / `FolderSecrets` types.
- **Schema** rewritten around the `secrets` array and published at `@2`.

### Migration

Convert each `secrets.json`: replace `paths`/`include`/`aliases` with a
`secrets` array of `{ folder: [ ...keys ] }` objects; list plain keys as bare
strings and each `aliases` source as a `{ SOURCE: "TARGET" }` object (repeat for
several targets); keep only the keys you want (the array is the allowlist).
Point `$schema` at `…/infisicml@2/…`.
Behavior note: an alias entry now emits **both** its canonical name and the
target(s) — v1 could suppress the canonical via `include`; v2 does not (the
security boundary is default-deny provenance, not alias suppression).

## [1.2.1] - 2026-07-17

### Changed (BREAKING)

- **Renamed the package, CLI, repo, and config from `infiscml` to `infisicml`**
  (a typo fix — the name is derived from *Infisical*). This is a hard break with
  **no compatibility shims** — consumers must migrate all references when they
  adopt the new package:
  - **npm package**: install `@hubble-ventures/infisicml`; the old
    `@hubble-ventures/infiscml` package is deprecated and receives no updates.
  - **CLI binary**: `infisicml` (the old `infiscml` binary is gone — update any
    scripts, `package.json` commands, and `node_modules/.bin` references).
  - **Config file**: only `infisicml.config.{json,mjs,js}` is discovered —
    rename `infiscml.config.*` to `infisicml.config.*`.
  - **Composite action input**: `infisicml-version` (the old `infiscml-version`
    input no longer exists).
  - **Exported type**: `InfisicmlConfig` (was `InfiscmlConfig`).
  - **Repository**: [`hubble-ventures/infisicml`](https://github.com/hubble-ventures/infisicml)
    (GitHub redirects the old URL).

## [1.2.0] - 2026-07-16

### Added

- **Least-privilege fetch (`fetch: "keys"`).** A new per-manifest `fetch` field
  (default `"folder"`) controls how secrets are read. In `"keys"` mode infisicml
  emits **only** the keys `include` resolves to. In **CI** this is enforced at
  the wire: each key is fetched with the single-secret REST endpoint
  (`GET /api/v3/secrets/raw/{name}`), so the vault never transmits the other
  keys in a folder — contrast folder mode, where `include` is a post-fetch
  filter and excluded values still travel over the wire. **Locally** the
  `infisical` CLI has no single-secret server read, so infisicml fetches each
  folder once and selects the keys (narrowing what's written, not what's
  transmitted). `include` names the final (post-alias) keys, so key mode
  **reverse-maps** each alias target to its canonical vault source before
  fetching, and import-surfaced keys still resolve. Everything after the fetch
  (aliases, `include` filtering,
  unknown-key enforcement, `optionalKeys`) is unchanged, so the emitted output
  matches folder mode. `fetch: "keys"` **requires** an `include` allowlist
  (enforced by `validate` and the pull / CI step). A per-profile `fetch`
  replaces the root one (same replace-not-merge as `paths` / `include`). Honored
  by `pull` and `export-gha`; surfaced by `list`, `paths`, and `validate`.
  Published in the exported JSON Schema. Omitting `fetch` is byte-for-byte
  backward compatible.

## [1.1.0] - 2026-07-16

### Added

- **Key-level `include` allowlist.** `secrets.json` can now emit only a chosen
  subset of the keys a folder yields (default-deny key selection), so a client
  package can pull a shared vendor folder but keep server secrets out of client
  builds and `GITHUB_ENV`. Add `include` at the manifest root and/or per profile
  (a profile's `include` replaces the root one). Applied **after** `aliases`, to
  the final set of names. An `include` key that no folder produced fails the pull
  / CI step unless it's listed in `environments.<slug>.optionalKeys` (downgraded
  to a `::notice::`). Honored by `pull`, `export-gha`, `list`, `paths`, and
  `validate`. Omitting `include` is fully backward compatible — every key is
  emitted, as before. Published in the exported JSON Schema.

## [1.0.0] - 2026-07-16

First public release. The `secrets.json` manifest contract and the
`infisicml.config` surface are now considered stable under semver — breaking
changes to either ship only in a new major.

### Added

- **Published to npm as a public scoped package** (`npm i -D @hubble-ventures/infisicml`,
  `npx --yes @hubble-ventures/infisicml@latest`). Released via npm **trusted publishing**
  (OIDC) with build provenance — no long-lived tokens.
- **Stable action ref.** `hubble-ventures/infisicml/action@v1` is a floating major
  tag that tracks the latest `v1.x`; consumers may also pin a release SHA.
- **CLI**: `pull`, `export-gha`, `list`, `validate`, `paths`, `run`.
- **Two auth lanes, one per environment.** Local dev uses the Infisical CLI user
  session (`infisical login`); CI uses **GitHub OIDC → Infisical machine
  identity** over the REST API, with no Infisical CLI in the runner.
- **Multi-target aliases.** One canonical vault key can be copied to several
  prefixed names in a single output (e.g. `GOOGLE_MAPS_API_KEY` →
  `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` **and** `VITE_GOOGLE_MAPS_API_KEY`). Real
  secrets of a target name always win; the operation is idempotent.
- **Per-package output filename.** `output` sets the written filename (e.g.
  `.env.local`, `.env`) next to each manifest.
- **Profiles** for deploy-only credentials — profile paths replace base paths, so
  release-time creds (e.g. `fly`) never leak into runtime output.
- **`advertiseKeys` hooks** publish runtime key *names* (never values) to
  `GITHUB_ENV` for deploy forwarding.
- **CI skip/stub** (`ci.skipWhenEnv`, `ci.stubInCi`) and **optional keys**
  (`environments.<slug>.optionalKeys`) that downgrade a missing key to a
  `::notice::` instead of failing CI.
- **Published JSON Schema** for `secrets.json`, served from
  `https://cdn.jsdelivr.net/npm/@hubble-ventures/infisicml@1/schema/secrets.schema.json`.

[2.1.0]: https://github.com/hubble-ventures/infisicml/releases/tag/v2.1.0
[2.0.0]: https://github.com/hubble-ventures/infisicml/releases/tag/v2.0.0
[1.2.0]: https://github.com/hubble-ventures/infisicml/releases/tag/v1.2.0
[1.1.0]: https://github.com/hubble-ventures/infisicml/releases/tag/v1.1.0
[1.0.0]: https://github.com/hubble-ventures/infisicml/releases/tag/v1.0.0
