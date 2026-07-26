#!/usr/bin/env node
import { parseArgs } from "node:util";
import { InfisicalProvider } from "./adapters/infisical.js";
import { discoverManifests } from "./adapters/workspace.js";
import {
  isEmptyDelta,
  ManifestError,
  renderDeltaText,
  type SecretsProvider,
} from "./core/index.js";
import { diffAll, hasChanges } from "./commands/diff.js";
import { pullToFiles } from "./commands/pull.js";
import { hasErrors, validateAll } from "./commands/validate.js";

const USAGE = `infisicml — declarative Infisical secret manifests

Usage:
  infisicml pull     [ids...] [--env ENV] [--profile NAME]
  infisicml validate [ids...] [--env ENV] [--against-vault] [--check-values]
  infisicml diff     [ids...] --base REF [--env ENV] [--profile NAME] [--exit-zero]
  infisicml list

Manifests are discovered as secrets.yaml files under the current directory.
Local auth: set INFISICAL_TOKEN (and optionally INFISICAL_API_URL).
Docs: https://github.com/hubble-ventures/infisicml
`;

async function main(): Promise<void> {
  const [subcommand, ...rest] = process.argv.slice(2);

  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    process.stdout.write(USAGE);
    return;
  }

  switch (subcommand) {
    case "pull":
      return pull(rest);
    case "validate":
      return validate(rest);
    case "diff":
      return diff(rest);
    case "list":
      return list();
    default:
      process.stderr.write(`Unknown subcommand: ${subcommand}\n\n${USAGE}`);
      process.exitCode = 1;
  }
}

async function pull(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      env: { type: "string" },
      profile: { type: "string" },
    },
  });

  const outcomes = await pullToFiles({
    root: process.cwd(),
    environment: values.env,
    profile: values.profile,
    provider: tokenProvider(),
    ids: positionals,
  });

  for (const outcome of outcomes) {
    console.log(`✅ ${outcome.id}: wrote ${outcome.output} (${outcome.count} vars)`);
  }
}

async function validate(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      env: { type: "string" },
      "against-vault": { type: "boolean", default: false },
      "check-values": { type: "boolean", default: false },
    },
  });

  const provider =
    values["against-vault"] || values["check-values"]
      ? tokenProvider()
      : undefined;

  const results = await validateAll({
    root: process.cwd(),
    environment: values.env,
    provider,
    checkValues: values["check-values"],
    ids: positionals,
  });

  for (const { file, issues } of results) {
    if (issues.length === 0) {
      console.log(`✅ ${file.id}: valid`);
      continue;
    }
    const errors = issues.filter((i) => i.level === "error").length;
    console.log(`${errors > 0 ? "❌" : "⚠️ "} ${file.id}:`);
    for (const issue of issues) {
      const at = [issue.path, issue.key].filter(Boolean).join(":");
      console.log(
        `   ${issue.level === "error" ? "error" : "warn "} ${at ? `${at} — ` : ""}${issue.message}`
      );
    }
  }

  if (hasErrors(results)) {
    process.exitCode = 1;
  } else {
    console.log(`\n${results.length} manifest(s) checked.`);
  }
}

function diff(args: string[]): void {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      base: { type: "string" },
      env: { type: "string" },
      profile: { type: "string" },
      "exit-zero": { type: "boolean", default: false },
    },
  });

  if (!values.base) throw new Error("diff requires --base REF");

  const diffs = diffAll({
    root: process.cwd(),
    base: values.base,
    environment: values.env,
    profile: values.profile,
    ids: positionals,
  });

  for (const { file, delta, isNew } of diffs) {
    if (isEmptyDelta(delta)) continue;
    console.log(`\n${file.id}${isNew ? " (new)" : ""}`);
    console.log(renderDeltaText(delta));
  }

  if (!hasChanges(diffs)) {
    console.log("No secret manifest changes.");
  } else if (!values["exit-zero"]) {
    process.exitCode = 1;
  }
}

function list(): void {
  const files = discoverManifests(process.cwd());
  if (files.length === 0) {
    console.log("No secrets.yaml manifests found.");
    return;
  }
  for (const file of files) console.log(`${file.id}\t${file.filename}`);
}

function tokenProvider(): SecretsProvider {
  const token = process.env.INFISICAL_TOKEN;
  if (!token) {
    throw new Error(
      "INFISICAL_TOKEN is not set — required to read from the vault locally."
    );
  }
  return new InfisicalProvider(token);
}

main().catch((error) => {
  if (error instanceof ManifestError) {
    for (const issue of error.issues) console.error(`error: ${issue.message}`);
  } else {
    console.error(error instanceof Error ? error.message : String(error));
  }
  process.exitCode = 1;
});
