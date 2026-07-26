import { normalizePath } from "../core/path.js";
import {
  type KeyEntry,
  type Manifest,
  manifestSchema,
  type SecretsBlock,
} from "../core/schema.js";

export type MigrationResult = {
  manifest: Manifest;
  /** Human-readable notes about anything that couldn't be carried over verbatim. */
  warnings: string[];
};

/**
 * Transform a parsed **v2** manifest object into a validated **v3** {@link Manifest}.
 *
 * v2's `secrets` is a nested folder tree (`{ name: [ entries ] }`); v3 is a flat
 * list of `{ path, keys }` blocks. `project` did not exist in a v2 manifest (it
 * lived in `infisicml.config` / the action inputs), so it must be supplied.
 *
 * The result is run through the v3 schema before returning, so a successful call
 * always yields a valid v3 manifest — or throws with the schema error.
 */
export function migrateV2(
  raw: unknown,
  options: { project: string }
): MigrationResult {
  const v2 = isRecord(raw) ? raw : {};
  const warnings: string[] = [];

  if (v2.version === 1) {
    warnings.push("Manifest already declares version: 1 — looks like v3 already.");
  }

  const secrets = flattenTree(v2.secrets, warnings, "secrets");

  const defaults: Record<string, unknown> = {};
  if (typeof v2.output === "string") defaults.output = v2.output;
  if (v2.fetch === "folder" || v2.fetch === "keys") defaults.fetch = v2.fetch;

  const profiles = mapProfiles(v2.profiles, warnings);
  const environments = mapEnvironments(v2.environments, warnings);

  if (isRecord(v2.ci)) {
    warnings.push(
      "Dropped `ci` block (skipWhenEnv/stubInCi) — v3 has no CI-stub mode; " +
        "gate the pull with a workflow `if:` instead."
    );
  }
  if (typeof v2.$schema === "string") {
    warnings.push("Replaced `$schema` with the v3 schema reference.");
  }

  const candidate = {
    version: 1,
    project: options.project,
    ...(Object.keys(defaults).length > 0 ? { defaults } : {}),
    secrets,
    ...(profiles ? { profiles } : {}),
    ...(environments ? { environments } : {}),
  };

  return { manifest: manifestSchema.parse(candidate), warnings };
}

// Anything that doesn't fit the v2 grammar is skipped but recorded, so a
// malformed source can never silently lose bindings on `--write` — the dropped
// paths surface as warnings the operator reviews (dry-run is the default).
function flattenTree(
  tree: unknown,
  warnings: string[],
  label: string
): SecretsBlock[] {
  if (!Array.isArray(tree)) {
    warnings.push(`\`${label}\` is not a list — nothing migrated from it.`);
    return [];
  }
  const blocks: SecretsBlock[] = [];
  for (const folderObj of tree) {
    if (!isRecord(folderObj)) {
      warnings.push(`Skipped a non-folder entry in \`${label}\`.`);
      continue;
    }
    for (const [name, contents] of Object.entries(folderObj)) {
      walkFolder(name, contents, blocks, warnings);
    }
  }
  return blocks;
}

// Emit one block per folder that has direct keys, parent before its subfolders,
// recursing into array-valued entries with the accumulated path.
function walkFolder(
  pathSoFar: string,
  contents: unknown,
  blocks: SecretsBlock[],
  warnings: string[]
): void {
  if (!Array.isArray(contents)) {
    warnings.push(`Skipped folder '${pathSoFar}' — its contents is not a list.`);
    return;
  }
  const keys: KeyEntry[] = [];
  const subfolders: Array<[string, unknown]> = [];
  for (const entry of contents) {
    if (typeof entry === "string") {
      keys.push(entry);
      continue;
    }
    if (!isRecord(entry)) {
      warnings.push(`Skipped an unsupported entry in '${pathSoFar}'.`);
      continue;
    }
    for (const [key, value] of Object.entries(entry)) {
      if (Array.isArray(value)) {
        subfolders.push([`${pathSoFar}/${key}`, value]);
      } else if (typeof value === "string") {
        // A single-pair alias; a multi-alias v2 object becomes several entries.
        keys.push({ [key]: value });
      } else {
        warnings.push(`Skipped '${pathSoFar}:${key}' — unsupported value.`);
      }
    }
  }
  if (keys.length > 0) blocks.push({ path: normalizePath(pathSoFar), keys });
  for (const [subPath, subContents] of subfolders) {
    walkFolder(subPath, subContents, blocks, warnings);
  }
}

function mapProfiles(
  profiles: unknown,
  warnings: string[]
): Record<string, { secrets: SecretsBlock[]; fetch?: "folder" | "keys" }> | undefined {
  if (!isRecord(profiles)) return undefined;
  const out: Record<
    string,
    { secrets: SecretsBlock[]; fetch?: "folder" | "keys" }
  > = {};
  for (const [name, config] of Object.entries(profiles)) {
    if (!isRecord(config)) {
      warnings.push(`Skipped profile '${name}' — not an object.`);
      continue;
    }
    const fetch = config.fetch;
    out[name] = {
      secrets: flattenTree(config.secrets, warnings, `profiles.${name}.secrets`),
      ...(fetch === "folder" || fetch === "keys" ? { fetch } : {}),
    };
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function mapEnvironments(
  environments: unknown,
  warnings: string[]
): Record<string, { optional?: string[] }> | undefined {
  if (!isRecord(environments)) return undefined;
  const out: Record<string, { optional?: string[] }> = {};
  for (const [env, config] of Object.entries(environments)) {
    if (!isRecord(config)) continue;
    const optionalKeys = config.optionalKeys;
    if (Array.isArray(optionalKeys)) {
      out[env] = { optional: optionalKeys.filter((k) => typeof k === "string") };
      warnings.push(`environments.${env}.optionalKeys → environments.${env}.optional`);
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
