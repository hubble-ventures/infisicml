import { ManifestError } from "./errors.js";
import { groupByPath } from "./group.js";
import type { CompiledManifest, Issue, SecretsProvider } from "./types.js";

/**
 * Fetch and assemble the emitted `{ VAR: value }` map for a compiled manifest.
 *
 * Reads each folder once (respecting the fetch mode — whole folder, or only the
 * declared keys), applies aliases folder-locally, and fails with every missing
 * required key at once. A key marked optional for the environment may be absent.
 */
export async function materialize(
  compiled: CompiledManifest,
  provider: SecretsProvider
): Promise<Record<string, string>> {
  const groups = groupByPath(compiled.bindings);
  const out: Record<string, string> = {};
  const missing: Issue[] = [];

  for (const [path, group] of groups) {
    const values =
      compiled.fetch === "keys"
        ? await provider.fetchKeys(
            compiled.project,
            compiled.environment,
            path,
            group.map((b) => b.sourceKey)
          )
        : await provider.fetchFolder(
            compiled.project,
            compiled.environment,
            path
          );

    for (const binding of group) {
      if (Object.hasOwn(values, binding.sourceKey)) {
        out[binding.targetVar] = values[binding.sourceKey] as string;
      } else if (!binding.optional) {
        missing.push({
          level: "error",
          code: "missing_key",
          path,
          key: binding.sourceKey,
          message: `Missing required key '${binding.sourceKey}' in ${path} (${compiled.environment})`,
        });
      }
    }
  }

  if (missing.length > 0) throw new ManifestError(missing);
  return sortByKey(out);
}

function sortByKey(record: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(record).sort(([a], [b]) => a.localeCompare(b))
  );
}
