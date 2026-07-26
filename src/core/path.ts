import { resolve, sep } from "node:path";

/** Normalize a folder path to a leading-slash, no-trailing-slash form. */
export function normalizePath(path: string): string {
  const trimmed = path.replace(/^\/+/, "").replace(/\/+$/, "");
  return trimmed.length === 0 ? "/" : `/${trimmed}`;
}

/**
 * Resolve an output filename against the manifest directory, refusing anything
 * that escapes it. `output` is a bare filename by schema, but we defend anyway —
 * a manifest is committed config and a traversal here would write outside the
 * package.
 */
export function resolveOutputPath(manifestDir: string, output: string): string {
  if (
    output.length === 0 ||
    output.includes("/") ||
    output.includes("\\") ||
    output.includes("..")
  ) {
    throw new Error(`Invalid output filename: ${output}`);
  }
  const dir = resolve(manifestDir);
  const out = resolve(manifestDir, output);
  if (out !== dir && !out.startsWith(dir + sep)) {
    throw new Error(`Output path escapes manifest directory: ${output}`);
  }
  return out;
}
