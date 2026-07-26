// Public library surface. The pure core plus the concrete adapters, so callers
// can embed pull/validate/diff in their own tooling.
export * from "./core/index.js";
export { InfisicalProvider, resolveApiUrl } from "./adapters/infisical.js";
export { migrateV2, type MigrationResult } from "./migrate/v2.js";
export {
  discoverManifests,
  loadManifest,
  type ManifestFile,
  readManifestAtRef,
  readManifestRaw,
  writeOutput,
} from "./adapters/workspace.js";
