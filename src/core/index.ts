// The pure core: parse → compile → (materialize | validate | diff). No I/O.
export { compile, readEntry, type CompileOptions } from "./compile.js";
export { diffCompiled, isEmptyDelta, renderDeltaMarkdown, renderDeltaText } from "./diff.js";
export { serializeDotenv } from "./dotenv.js";
export { ManifestError } from "./errors.js";
export { groupByPath } from "./group.js";
export { materialize } from "./materialize.js";
export { normalizePath, resolveOutputPath } from "./path.js";
export { parseManifest, parseYamlText } from "./parse.js";
export {
  type KeyEntry,
  type Manifest,
  manifestSchema,
  type SecretsBlock,
} from "./schema.js";
export {
  validateAgainstVault,
  validateStructure,
  type VaultValidateOptions,
} from "./validate.js";
export type {
  Binding,
  BindingChange,
  CompiledManifest,
  FetchMode,
  Issue,
  IssueLevel,
  ManifestDelta,
  SecretsProvider,
  SettingChange,
} from "./types.js";
