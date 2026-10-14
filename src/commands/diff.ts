import { relative } from "node:path";
import {
  type CompiledManifest,
  compile,
  diffCompiled,
  isEmptyDelta,
  type ManifestDelta,
  parseManifest,
} from "../core/index.js";
import {
  discoverManifests,
  filterManifests,
  loadManifest,
  type ManifestFile,
  readManifestAtRef,
  resolveRef,
} from "../adapters/workspace.js";

export type DiffOptions = {
  root: string;
  /** Git ref (branch/sha/tag) to compare against, e.g. `origin/main`. */
  base: string;
  environment?: string;
  profile?: string;
  ids?: string[];
};

export type ManifestDiff = {
  file: ManifestFile;
  delta: ManifestDelta;
  /** True when the manifest did not exist at the base ref (newly added). */
  isNew: boolean;
};

/**
 * Diff every selected head manifest against its state at `base`. An empty
 * manifest at the base (compiled from no bindings) makes a newly added manifest
 * render as all-added.
 *
 * Note: a manifest deleted on the head branch is not discovered here — diffing
 * covers additions and modifications, the security-relevant PR review surface.
 */
export function diffAll(options: DiffOptions): ManifestDiff[] {
  // Resolve the base to a fixed commit once: rejects a bad `--base` up front
  // (otherwise every read fails and each manifest looks newly added), and pins
  // all reads to one tree even if the branch moves mid-run.
  const baseSha = resolveRef(options.base);
  if (!baseSha) {
    throw new Error(`Unknown base ref: ${options.base}`);
  }
  const files = filterManifests(discoverManifests(options.root), options.ids);
  const compileOpts = {
    environment: options.environment,
    profile: options.profile,
  };

  const diffs: ManifestDiff[] = [];
  for (const file of files) {
    const head = compile(loadManifest(file), compileOpts);

    const repoRelative = relative(options.root, file.path);
    const baseRaw = readManifestAtRef(baseSha, repoRelative);
    const isNew = baseRaw === null;
    // A manifest absent at the base has the same settings as head but no
    // bindings, so its whole surface renders as added (no phantom settings diff).
    const base: CompiledManifest = isNew
      ? { ...head, bindings: [] }
      : compile(parseManifest(baseRaw), compileOpts);

    diffs.push({ file, delta: diffCompiled(base, head), isNew });
  }
  return diffs;
}

export function hasChanges(diffs: ManifestDiff[]): boolean {
  return diffs.some((d) => !isEmptyDelta(d.delta));
}
