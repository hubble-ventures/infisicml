import { compile } from "./compile.js";
import { ManifestError } from "./errors.js";
import { groupByPath } from "./group.js";
import { manifestSchema } from "./schema.js";
import type { CompiledManifest, Issue, SecretsProvider } from "./types.js";

/**
 * Tier 1 — schema + structural validation. Pure, no network. Runs the schema,
 * then compiles the default environment and every profile to surface unknown
 * references and duplicate target variables. Returns all issues (empty = valid).
 */
export function validateStructure(raw: unknown): Issue[] {
  const parsed = manifestSchema.safeParse(raw);
  if (!parsed.success) {
    return parsed.error.issues.map((issue) => ({
      level: "error" as const,
      code: "schema",
      key: issue.path.join(".") || undefined,
      message: issue.message,
    }));
  }

  const manifest = parsed.data;
  const issues: Issue[] = [];
  const profiles = [undefined, ...Object.keys(manifest.profiles ?? {})];
  for (const profile of profiles) {
    try {
      compile(manifest, { profile });
    } catch (error) {
      if (error instanceof ManifestError) issues.push(...error.issues);
      else throw error;
    }
  }
  return dedupeIssues(issues);
}

export type VaultValidateOptions = {
  /** Also read values and flag present-but-empty required keys (tier 3). */
  checkValues?: boolean;
};

/**
 * Tiers 2 & 3 — validate a compiled manifest against the live vault.
 *
 *  - **Tier 2 (presence):** every declared non-optional key must exist in its
 *    folder; keys in the vault that the manifest does not declare are reported
 *    as drift warnings.
 *  - **Tier 3 (values, opt-in):** a present-but-empty required key is an error.
 */
export async function validateAgainstVault(
  compiled: CompiledManifest,
  provider: SecretsProvider,
  options: VaultValidateOptions = {}
): Promise<Issue[]> {
  const groups = groupByPath(compiled.bindings);
  const issues: Issue[] = [];

  for (const [path, group] of groups) {
    const present = new Set(
      await provider.listKeys(compiled.project, compiled.environment, path)
    );
    for (const binding of group) {
      if (!present.has(binding.sourceKey) && !binding.optional) {
        issues.push({
          level: "error",
          code: "missing_in_vault",
          path,
          key: binding.sourceKey,
          message: `Declared key '${binding.sourceKey}' not found in ${path} (${compiled.environment})`,
        });
      }
    }
    const declared = new Set(group.map((b) => b.sourceKey));
    for (const key of present) {
      if (!declared.has(key)) {
        issues.push({
          level: "warning",
          code: "undeclared_in_vault",
          path,
          key,
          message: `Vault key '${key}' in ${path} is not declared in the manifest`,
        });
      }
    }
  }

  if (options.checkValues) {
    for (const [path, group] of groups) {
      const values = await provider.fetchKeys(
        compiled.project,
        compiled.environment,
        path,
        group.map((b) => b.sourceKey)
      );
      for (const binding of group) {
        if (
          !binding.optional &&
          Object.hasOwn(values, binding.sourceKey) &&
          values[binding.sourceKey] === ""
        ) {
          issues.push({
            level: "error",
            code: "empty_value",
            path,
            key: binding.sourceKey,
            message: `Key '${binding.sourceKey}' in ${path} is present but empty`,
          });
        }
      }
    }
  }

  return issues;
}

function dedupeIssues(issues: Issue[]): Issue[] {
  const seen = new Set<string>();
  const out: Issue[] = [];
  for (const issue of issues) {
    const id = `${issue.code}|${issue.path ?? ""}|${issue.key ?? ""}|${issue.message}`;
    if (!seen.has(id)) {
      seen.add(id);
      out.push(issue);
    }
  }
  return out;
}
