import { ManifestError } from "./errors.js";
import { normalizePath } from "./path.js";
import type { KeyEntry, Manifest, SecretsBlock } from "./schema.js";
import type { Binding, CompiledManifest, FetchMode, Issue } from "./types.js";

export type CompileOptions = {
  /** Environment to resolve; falls back to `defaults.environment`, then `development`. */
  environment?: string;
  /** Profile whose `secrets`/`fetch` replace the root ones. */
  profile?: string;
};

const DEFAULT_ENVIRONMENT = "development";
const DEFAULT_OUTPUT = ".env.secrets";
const DEFAULT_FETCH: FetchMode = "folder";

/**
 * Compile a manifest into a flat, sorted, collision-free list of bindings for a
 * single environment. This is the one place the authoring format is interpreted;
 * pull / validate / diff all consume the result.
 *
 * Throws {@link ManifestError} on an unknown profile or a duplicate target
 * variable.
 */
export function compile(
  manifest: Manifest,
  options: CompileOptions = {}
): CompiledManifest {
  const environment =
    options.environment ??
    manifest.defaults?.environment ??
    DEFAULT_ENVIRONMENT;
  const blocks = selectBlocks(manifest, options.profile);
  const optional = new Set(manifest.environments?.[environment]?.optional ?? []);

  const bindings: Binding[] = [];
  for (const block of blocks) {
    const path = normalizePath(block.path);
    for (const entry of block.keys) {
      const { sourceKey, targetVar } = readEntry(entry);
      bindings.push({
        path,
        sourceKey,
        targetVar,
        optional: optional.has(sourceKey),
      });
    }
  }
  bindings.sort(compareBindings);
  assertNoCollisions(bindings);

  return {
    project: manifest.project,
    environment,
    fetch: resolveFetch(manifest, options.profile),
    output: manifest.defaults?.output ?? DEFAULT_OUTPUT,
    bindings,
  };
}

/** Decompose a key entry into its source key and emitted target variable. */
export function readEntry(entry: KeyEntry): {
  sourceKey: string;
  targetVar: string;
} {
  if (typeof entry === "string") return { sourceKey: entry, targetVar: entry };
  // The schema already enforces exactly one pair; guard anyway so a hand-built
  // manifest (or a future schema slip) can never silently drop extra aliases.
  const pairs = Object.entries(entry);
  if (pairs.length !== 1) throw new ManifestError([aliasError()]);
  const [sourceKey, targetVar] = pairs[0] as [string, string];
  return { sourceKey, targetVar };
}

function selectBlocks(manifest: Manifest, profile?: string): SecretsBlock[] {
  if (!profile) return manifest.secrets;
  const config = manifest.profiles?.[profile];
  if (!config) {
    throw new ManifestError([
      {
        level: "error",
        code: "unknown_profile",
        message: `Unknown profile '${profile}'`,
      },
    ]);
  }
  return config.secrets;
}

function resolveFetch(manifest: Manifest, profile?: string): FetchMode {
  if (profile) {
    const profileFetch = manifest.profiles?.[profile]?.fetch;
    if (profileFetch) return profileFetch;
  }
  return manifest.defaults?.fetch ?? DEFAULT_FETCH;
}

function compareBindings(a: Binding, b: Binding): number {
  return a.path === b.path
    ? a.targetVar.localeCompare(b.targetVar)
    : a.path.localeCompare(b.path);
}

// Two bindings emitting the same variable is always a bug: one would silently
// overwrite the other. Report every collision at once so a fix is one pass.
function assertNoCollisions(bindings: Binding[]): void {
  const seen = new Map<string, Binding>();
  const issues: Issue[] = [];
  for (const binding of bindings) {
    const prev = seen.get(binding.targetVar);
    if (prev) {
      issues.push({
        level: "error",
        code: "duplicate_target",
        key: binding.targetVar,
        message: `Duplicate target variable '${binding.targetVar}' (from ${prev.path}:${prev.sourceKey} and ${binding.path}:${binding.sourceKey})`,
      });
    } else {
      seen.set(binding.targetVar, binding);
    }
  }
  if (issues.length > 0) throw new ManifestError(issues);
}

function aliasError(): Issue {
  return {
    level: "error",
    code: "invalid_alias",
    message: "an alias must map exactly one source key to one target",
  };
}
