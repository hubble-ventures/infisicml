import {
  InfisicalProvider,
  resolveApiUrl,
} from "./adapters/infisical.js";
import {
  appendSummary,
  core,
  exportSecrets,
  getOidcToken,
  upsertPrComment,
} from "./adapters/gha.js";
import {
  isEmptyDelta,
  type ManifestDelta,
  renderDeltaMarkdown,
  type SecretsProvider,
} from "./core/index.js";
import { diffAll, hasChanges } from "./commands/diff.js";
import { resolveAll } from "./commands/resolve.js";
import { hasErrors, validateAll } from "./commands/validate.js";

// Thin GitHub Actions entry point. All logic lives in the shared command layer;
// this maps action inputs → commands → job env / outputs / summary.
async function run(): Promise<void> {
  const command = core.getInput("command", { required: true });
  const environment = core.getInput("environment") || undefined;
  const profile = core.getInput("profile") || undefined;
  const ids = splitList(core.getInput("ids"));
  const root = process.cwd();

  switch (command) {
    case "pull":
      return runPull({ root, environment, profile, ids });
    case "validate":
      return runValidate({ root, environment, profile, ids });
    case "diff":
      return runDiff({ root, environment, profile, ids });
    default:
      core.setFailed(`Unknown command '${command}' (expected pull|validate|diff)`);
  }
}

type Common = {
  root: string;
  environment?: string;
  profile?: string;
  ids?: string[];
};

async function runPull(opts: Common): Promise<void> {
  const provider = await authenticate();
  const resolved = await resolveAll({ ...opts, provider });

  let total = 0;
  for (const { file, values } of resolved) {
    exportSecrets(values);
    total += Object.keys(values).length;
    core.info(`Loaded ${Object.keys(values).length} vars from ${file.id}`);
  }
  core.setOutput("manifests", resolved.length);
  core.setOutput("count", total);
  core.info(`Exported ${total} secret(s) from ${resolved.length} manifest(s).`);
}

async function runValidate(opts: Common): Promise<void> {
  const againstVault = core.getBooleanInput("against-vault");
  const checkValues = core.getBooleanInput("check-values");
  const provider =
    againstVault || checkValues ? await authenticate() : undefined;

  const results = await validateAll({
    root: opts.root,
    environment: opts.environment,
    profile: opts.profile,
    ids: opts.ids,
    provider,
    checkValues,
  });

  const lines = ["### infisicml validate", ""];
  for (const { file, issues } of results) {
    if (issues.length === 0) {
      lines.push(`- ✅ \`${file.id}\``);
      continue;
    }
    lines.push(`- ${issues.some((i) => i.level === "error") ? "❌" : "⚠️"} \`${file.id}\``);
    for (const issue of issues) {
      const at = [issue.path, issue.key].filter(Boolean).join(":");
      lines.push(`  - ${issue.level}: ${at ? `\`${at}\` — ` : ""}${issue.message}`);
    }
  }
  await appendSummary(lines.join("\n"));

  if (hasErrors(results)) {
    core.setFailed("Manifest validation failed.");
  }
}

async function runDiff(opts: Common): Promise<void> {
  const base = core.getInput("base", { required: true });
  const failOnChange = core.getBooleanInput("fail-on-change");
  const comment = core.getBooleanInput("comment");

  const diffs = diffAll({
    root: opts.root,
    base,
    environment: opts.environment,
    profile: opts.profile,
    ids: opts.ids,
  });

  const sections = diffs
    .filter((d) => !isEmptyDelta(d.delta))
    .map((d) =>
      renderDeltaMarkdown(d.delta, `\`${d.file.id}\`${d.isNew ? " (new)" : ""}`)
    );
  const markdown =
    sections.length > 0
      ? `## Secret manifest changes (base: \`${base}\`)\n\n${sections.join("\n")}`
      : `## Secret manifest changes (base: \`${base}\`)\n\n_No changes._`;

  await appendSummary(markdown);

  const changed = hasChanges(diffs);
  core.setOutput("changed", changed);
  core.setOutput("added", count(diffs, (d) => d.added.length));
  core.setOutput("removed", count(diffs, (d) => d.removed.length));
  core.setOutput("changed-count", count(diffs, (d) => d.changed.length));

  if (comment) {
    const token = core.getInput("github-token");
    if (!token) {
      core.warning("comment: true but no github-token provided — skipping PR comment.");
    } else {
      // A comment failure (e.g. missing pull-requests: write on a fork PR) must
      // not fail the diff itself — the summary and outputs are already set.
      try {
        await upsertPrComment(token, markdown);
      } catch (error) {
        core.warning(
          `Failed to post PR comment: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }

  if (changed && failOnChange) {
    core.setFailed("Secret manifest changed — review required.");
  }
}

/** OIDC → Infisical access token. Requires `permissions: id-token: write`. */
async function authenticate(): Promise<SecretsProvider> {
  const identityId = core.getInput("identity-id", { required: true });
  const audience = core.getInput("oidc-audience") || undefined;
  const jwt = await getOidcToken(audience);
  return InfisicalProvider.loginWithOidc(identityId, jwt, resolveApiUrl());
}

function count(
  diffs: Array<{ delta: ManifestDelta }>,
  pick: (d: ManifestDelta) => number
): number {
  return diffs.reduce((sum, d) => sum + pick(d.delta), 0);
}

function splitList(value: string): string[] | undefined {
  const items = value
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return items.length > 0 ? items : undefined;
}

run().catch((error) => {
  core.setFailed(error instanceof Error ? error.message : String(error));
});
