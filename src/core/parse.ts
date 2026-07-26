import { parse as parseYaml } from "yaml";
import { type Manifest, manifestSchema } from "./schema.js";

/** Parse YAML (or JSON — YAML is a superset) text into an unvalidated object. */
export function parseYamlText(text: string): unknown {
  return parseYaml(text);
}

/** Validate an already-parsed object against the manifest schema. Throws on error. */
export function parseManifest(raw: unknown): Manifest {
  return manifestSchema.parse(raw);
}
