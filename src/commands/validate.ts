import {
  compile,
  type Issue,
  type SecretsProvider,
  validateAgainstVault,
  validateStructure,
} from "../core/index.js";
import {
  discoverManifests,
  loadManifest,
  type ManifestFile,
  readManifestRaw,
} from "../adapters/workspace.js";

export type ValidateOptions = {
  root: string;
  environment?: string;
  /** When set, also run tiers 2/3 against the vault. */
  provider?: SecretsProvider;
  /** Tier 3 — flag present-but-empty required keys. Implies a value read. */
  checkValues?: boolean;
  ids?: string[];
};

export type ManifestValidation = {
  file: ManifestFile;
  issues: Issue[];
};

/**
 * Validate every selected manifest. Always runs tier 1 (schema + structure);
 * when a provider is supplied, also runs tiers 2/3 against the vault. A manifest
 * that fails tier 1 is not checked against the vault (its compile would throw).
 */
export async function validateAll(
  options: ValidateOptions
): Promise<ManifestValidation[]> {
  const files = filterIds(discoverManifests(options.root), options.ids);
  const results: ManifestValidation[] = [];

  for (const file of files) {
    const raw = readManifestRaw(file);
    const issues = validateStructure(raw);

    if (issues.length === 0 && options.provider) {
      // Safe to load + compile now — tier 1 passed, so neither throws.
      const compiled = compile(loadManifest(file), {
        environment: options.environment,
      });
      issues.push(
        ...(await validateAgainstVault(compiled, options.provider, {
          checkValues: options.checkValues,
        }))
      );
    }
    results.push({ file, issues });
  }
  return results;
}

export function hasErrors(results: ManifestValidation[]): boolean {
  return results.some((r) => r.issues.some((i) => i.level === "error"));
}

function filterIds(files: ManifestFile[], ids?: string[]): ManifestFile[] {
  if (!ids || ids.length === 0) return files;
  const wanted = new Set(ids);
  return files.filter((f) => wanted.has(f.id));
}
