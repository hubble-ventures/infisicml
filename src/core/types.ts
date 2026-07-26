// Shared types for the pure core. Nothing here performs I/O; adapters supply the
// concrete SecretsProvider implementation.

/** Wire strategy for reading a folder's secrets from the vault. */
export type FetchMode = "folder" | "keys";

/**
 * One resolved secret binding: a single vault key mapped to a single emitted
 * environment variable. A manifest compiles to a flat, sorted list of these, and
 * pull / validate / diff are all pure functions over that list.
 */
export type Binding = {
  /** Normalized Infisical folder path, e.g. `/payments/stripe`. */
  path: string;
  /** Key name as stored in the vault. */
  sourceKey: string;
  /** Environment-variable name to emit (after aliasing). */
  targetVar: string;
  /** Declared as allowed-to-be-absent for the resolved environment. */
  optional: boolean;
};

/** A manifest resolved for one environment (and optional profile). */
export type CompiledManifest = {
  project: string;
  environment: string;
  fetch: FetchMode;
  /** Output filename (bare, no separators), relative to the manifest directory. */
  output: string;
  bindings: Binding[];
};

export type IssueLevel = "error" | "warning";

/** A single structured problem found while validating a manifest. */
export type Issue = {
  level: IssueLevel;
  /** Stable machine code, e.g. `duplicate_target`, `missing_in_vault`. */
  code: string;
  message: string;
  /** Folder path the issue concerns, when applicable. */
  path?: string;
  /** Key or variable name the issue concerns, when applicable. */
  key?: string;
};

/**
 * The vault, abstracted. The core depends only on this interface; the Infisical
 * adapter implements it, and tests supply fakes. No method ever returns a value
 * for a key that does not exist.
 */
export interface SecretsProvider {
  /** All key names present in a folder for an environment. */
  listKeys(
    project: string,
    environment: string,
    path: string
  ): Promise<string[]>;
  /** Every key/value in a folder (whole-folder read). */
  fetchFolder(
    project: string,
    environment: string,
    path: string
  ): Promise<Record<string, string>>;
  /** Only the named keys (least-privilege read). Absent keys are omitted. */
  fetchKeys(
    project: string,
    environment: string,
    path: string,
    keys: string[]
  ): Promise<Record<string, string>>;
}

/** A binding present in both manifests but pointing somewhere different. */
export type BindingChange = { targetVar: string; from: Binding; to: Binding };

/** A scalar manifest setting that changed (project, environment, fetch, output). */
export type SettingChange = { field: string; from: string; to: string };

/** The structural delta between two compiled manifests. */
export type ManifestDelta = {
  added: Binding[];
  removed: Binding[];
  changed: BindingChange[];
  settings: SettingChange[];
};
