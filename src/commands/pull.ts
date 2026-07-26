import { writeOutput } from "../adapters/workspace.js";
import { resolveOutputPath, serializeDotenv } from "../core/index.js";
import { resolveAll, type ResolveOptions } from "./resolve.js";

export type PullOutcome = {
  id: string;
  /** Output filename, e.g. `.env.secrets`. */
  output: string;
  /** Absolute path written. */
  path: string;
  count: number;
};

/**
 * Resolve every selected manifest and write its secrets to the dotenv file next
 * to the manifest. Returns one outcome per package (the sink used by the CLI;
 * the Action exports to the job env instead).
 */
export async function pullToFiles(
  options: ResolveOptions
): Promise<PullOutcome[]> {
  const resolved = await resolveAll(options);
  const outcomes: PullOutcome[] = [];
  for (const { file, compiled, values } of resolved) {
    const path = resolveOutputPath(file.dir, compiled.output);
    writeOutput(path, renderEnvFile(file.id, compiled.environment, values));
    outcomes.push({
      id: file.id,
      output: compiled.output,
      path,
      count: Object.keys(values).length,
    });
  }
  return outcomes;
}

/** Render the dotenv file body, with a provenance header, for a package. */
export function renderEnvFile(
  id: string,
  environment: string,
  secrets: Record<string, string>
): string {
  const header = [
    "# Pulled from Infisical — do not edit. Refresh: infisicml pull",
    `# Package: ${id}`,
    `# Environment: ${environment}`,
    "",
  ].join("\n");
  return header + serializeDotenv(secrets);
}
