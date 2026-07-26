import {
  type CompiledManifest,
  compile,
  materialize,
  type SecretsProvider,
} from "../core/index.js";
import {
  discoverManifests,
  loadManifest,
  type ManifestFile,
} from "../adapters/workspace.js";

export type ResolveOptions = {
  root: string;
  environment?: string;
  profile?: string;
  provider: SecretsProvider;
  /** Restrict to these manifest ids (default: all discovered). */
  ids?: string[];
};

export type ResolvedPackage = {
  file: ManifestFile;
  compiled: CompiledManifest;
  values: Record<string, string>;
};

/**
 * Discover, compile, and fetch every selected manifest. Returns the compiled
 * form plus the resolved `{ VAR: value }` map for each — leaving the *sink*
 * (write a dotenv file, export to the job env) to the caller.
 */
export async function resolveAll(
  options: ResolveOptions
): Promise<ResolvedPackage[]> {
  const files = selectManifests(options.root, options.ids);
  const resolved: ResolvedPackage[] = [];
  for (const file of files) {
    const manifest = loadManifest(file);
    const compiled = compile(manifest, {
      environment: options.environment,
      profile: options.profile,
    });
    const values = await materialize(compiled, options.provider);
    resolved.push({ file, compiled, values });
  }
  return resolved;
}

export function selectManifests(root: string, ids?: string[]): ManifestFile[] {
  const all = discoverManifests(root);
  if (!ids || ids.length === 0) return all;
  const wanted = new Set(ids);
  const picked = all.filter((f) => wanted.has(f.id));
  const missing = ids.filter((id) => !all.some((f) => f.id === id));
  if (missing.length > 0) {
    throw new Error(`Unknown manifest id(s): ${missing.join(", ")}`);
  }
  return picked;
}
