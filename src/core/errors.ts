import type { Issue } from "./types.js";

/**
 * A manifest that cannot be compiled. Carries one or more structured issues so
 * callers can render them (the CLI, the validate command) or fail hard (pull).
 */
export class ManifestError extends Error {
  readonly issues: Issue[];

  constructor(issues: Issue[]) {
    super(issues.map((i) => i.message).join("; "));
    this.name = "ManifestError";
    this.issues = issues;
  }
}
