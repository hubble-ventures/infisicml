import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { type Manifest, parseManifest, parseYamlText } from "../core/index.js";

// A package's manifest is `secrets.yaml` (or `.yml`) sitting in the package
// directory. Discovery walks the tree for them.
const MANIFEST_NAMES = ["secrets.yaml", "secrets.yml"] as const;
const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".turbo",
  ".next",
  "coverage",
]);

export type ManifestFile = {
  /** Stable package id: the manifest's directory relative to the root (`.` = root). */
  id: string;
  /** Absolute directory holding the manifest. */
  dir: string;
  /** Absolute path to the manifest file. */
  path: string;
  /** The manifest filename, e.g. `secrets.yaml`. */
  filename: string;
};

/**
 * Find every package manifest under `root`, sorted by id. Two manifest files in
 * one directory is a hard error — silently preferring one could pull the wrong
 * secret tree.
 */
export function discoverManifests(root: string): ManifestFile[] {
  const found: ManifestFile[] = [];
  walk(root, root, found);
  return found.sort((a, b) => a.id.localeCompare(b.id));
}

function walk(root: string, dir: string, out: ManifestFile[]): void {
  const present = MANIFEST_NAMES.filter((name) => existsSync(join(dir, name)));
  if (present.length > 1) {
    throw new Error(
      `Ambiguous manifest in ${dir}: found ${present.join(", ")} — keep exactly one.`
    );
  }
  if (present.length === 1) {
    const filename = present[0] as string;
    const rel = relative(root, dir);
    out.push({
      id: rel === "" ? "." : rel.split(sep).join("/"),
      dir,
      path: join(dir, filename),
      filename,
    });
  }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (
      entry.isDirectory() &&
      !IGNORE_DIRS.has(entry.name) &&
      !entry.name.startsWith(".")
    ) {
      walk(root, join(dir, entry.name), out);
    }
  }
}

/**
 * Restrict `files` to the requested ids, throwing on an unknown id so every
 * command reports a typo the same way (rather than silently doing nothing).
 */
export function filterManifests(
  files: ManifestFile[],
  ids?: string[]
): ManifestFile[] {
  if (!ids || ids.length === 0) return files;
  const missing = ids.filter((id) => !files.some((f) => f.id === id));
  if (missing.length > 0) {
    throw new Error(`Unknown manifest id(s): ${missing.join(", ")}`);
  }
  const wanted = new Set(ids);
  return files.filter((f) => wanted.has(f.id));
}

/** Read the raw (unvalidated) manifest object — for `validateStructure`. */
export function readManifestRaw(file: ManifestFile): unknown {
  return parseYamlText(readFileSync(file.path, "utf8"));
}

/** Read and schema-validate a manifest. Throws on a malformed manifest. */
export function loadManifest(file: ManifestFile): Manifest {
  return parseManifest(readManifestRaw(file));
}

/**
 * Read a manifest's content at a git ref (for diffing a PR against its base).
 * Returns `null` when the file did not exist at that ref (e.g. a newly added
 * manifest), which the caller renders as an all-added diff.
 */
export function readManifestAtRef(
  ref: string,
  repoRelativePath: string
): unknown | null {
  let text: string;
  try {
    text = execFileSync("git", ["show", `${ref}:${repoRelativePath}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    // The file didn't exist at that ref (or the ref is unknown) — treat as
    // absent. A malformed YAML at the ref must NOT be masked as "absent", so
    // parse outside this catch and let a parse error propagate.
    return null;
  }
  return parseYamlText(text);
}

// Secret output files are written owner-only (0600) — they hold vault values.
// The mode applies on creation; an existing file keeps its permissions.
export function writeOutput(path: string, content: string): void {
  writeFileSync(path, content, { mode: 0o600 });
}
