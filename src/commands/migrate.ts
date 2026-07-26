import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";
import { stringify } from "yaml";
import { parseYamlText } from "../core/index.js";
import { migrateV2 } from "../migrate/v2.js";

// v2 manifests could be YAML or JSON; v3 discovery only recognizes YAML, so the
// migrator has to find `.json` sources too.
const V2_NAMES = ["secrets.yaml", "secrets.yml", "secrets.json"] as const;
const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".turbo",
  ".next",
  "coverage",
]);

const SCHEMA_URL =
  "https://unpkg.com/@hubble-ventures/infisicml/schema/secrets.schema.json";

export type MigrateOptions = {
  root: string;
  project: string;
  /** Write `secrets.yaml`; otherwise this is a dry run. */
  write?: boolean;
};

export type MigrationReport = {
  id: string;
  /** The source manifest filename found, e.g. `secrets.json`. */
  source: string;
  /** The rendered v3 YAML. */
  yaml: string;
  warnings: string[];
  /** Absolute path written, when `write` was set. */
  wrote?: string;
  /** True when the source already looked like v3 and was skipped. */
  skipped?: boolean;
};

/** Migrate every v2 manifest found under `root` to v3. */
export function migrateAll(options: MigrateOptions): MigrationReport[] {
  const files: Array<{ id: string; source: string; path: string; dir: string }> = [];
  walk(options.root, options.root, files);

  const reports: MigrationReport[] = [];
  for (const file of files) {
    const raw = parseYamlText(readFileSync(file.path, "utf8"));
    if (isRecord(raw) && raw.version === 1) {
      reports.push({ id: file.id, source: file.source, yaml: "", warnings: [], skipped: true });
      continue;
    }

    const { manifest, warnings } = migrateV2(raw, { project: options.project });
    const yaml = renderYaml(manifest);

    const report: MigrationReport = { id: file.id, source: file.source, yaml, warnings };
    if (basename(file.source) !== "secrets.yaml") {
      report.warnings = [
        ...warnings,
        `Wrote secrets.yaml; the old ${file.source} is now stale — remove it.`,
      ];
    }
    if (options.write) {
      const target = join(file.dir, "secrets.yaml");
      writeFileSync(target, yaml);
      report.wrote = target;
    }
    reports.push(report);
  }
  return reports;
}

function renderYaml(manifest: unknown): string {
  return `# yaml-language-server: $schema=${SCHEMA_URL}\n${stringify(manifest)}`;
}

function walk(
  root: string,
  dir: string,
  out: Array<{ id: string; source: string; path: string; dir: string }>
): void {
  for (const name of V2_NAMES) {
    if (existsSync(join(dir, name))) {
      const rel = relative(root, dir);
      out.push({
        id: rel === "" ? "." : rel.split(sep).join("/"),
        source: name,
        path: join(dir, name),
        dir,
      });
    }
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
