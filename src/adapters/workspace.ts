import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    // Return null ONLY when git proves the path is absent at this (already
    // resolved) commit — a genuinely new manifest. Any other git failure (I/O,
    // permissions, a corrupt repo) must propagate, not be misread as "absent".
    const stderr = String((error as { stderr?: unknown }).stderr ?? "");
    if (/does not exist in|exists on disk, but not in/i.test(stderr)) return null;
    throw error;
  }
  // Parse outside the catch so a malformed YAML at the ref surfaces as an error
  // rather than being masked as "absent".
  return parseYamlText(text);
}

/**
 * Resolve `ref` to a fixed commit SHA, or `null` if it doesn't resolve. Diffing
 * pins the base to this SHA once so every manifest is read from the same tree,
 * even if the branch moves mid-run.
 */
export function resolveRef(ref: string): string | null {
  try {
    return execFileSync(
      "git",
      ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    ).trim();
  } catch {
    return null;
  }
}

/**
 * Write a secret output file atomically and owner-only. Content goes to a fresh
 * temp file created at 0600, then renamed over the destination — so the secret
 * is never momentarily visible at a looser mode (which a plain overwrite +
 * chmod would allow), and a partial write never replaces a good file.
 */
export function writeOutput(path: string, content: string): void {
  const tmp = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(tmp, content, { mode: 0o600 });
    renameSync(tmp, path);
  } catch (error) {
    rmSync(tmp, { force: true });
    throw error;
  }
}
