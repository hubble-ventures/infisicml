import { randomUUID } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";

// A tiny, dependency-free implementation of the handful of GitHub Actions
// toolkit primitives this action uses. Each is a documented "workflow command"
// (a line on stdout) or a file-command (append to a path named by an env var) —
// so vendoring @actions/core (which would inline @actions/http-client et al.
// into the committed bundle) buys nothing here.

/** The subset of `@actions/core` the action layer calls. */
export const core = {
  getInput(name: string, opts?: { required?: boolean }): string {
    const raw = process.env[`INPUT_${name.replace(/ /g, "_").toUpperCase()}`];
    const value = (raw ?? "").trim();
    if (opts?.required && value === "") {
      throw new Error(`Input required and not supplied: ${name}`);
    }
    return value;
  },
  getBooleanInput(name: string): boolean {
    return /^(true|yes|1)$/i.test(core.getInput(name));
  },
  setOutput(name: string, value: string | number | boolean): void {
    writeFileCommand("GITHUB_OUTPUT", name, String(value));
  },
  setSecret(secret: string): void {
    issueCommand("add-mask", secret);
  },
  exportVariable(name: string, value: string): void {
    writeFileCommand("GITHUB_ENV", name, value);
  },
  info(message: string): void {
    process.stdout.write(`${message}\n`);
  },
  warning(message: string): void {
    issueCommand("warning", message);
  },
  setFailed(message: string): void {
    issueCommand("error", message);
    process.exitCode = 1;
  },
};

/**
 * Export a secret map into the job environment. Every value is masked *before*
 * it is written so it can never surface in logs, then appended to `$GITHUB_ENV`
 * for subsequent steps.
 */
export function exportSecrets(vars: Record<string, string>): void {
  for (const [key, value] of Object.entries(vars)) {
    core.setSecret(value);
    core.exportVariable(key, value);
  }
}

/** Mint a GitHub OIDC token for the given audience (requires `id-token: write`). */
export async function getOidcToken(audience?: string): Promise<string> {
  const requestUrl = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const requestToken = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!requestUrl || !requestToken) {
    throw new Error(
      "OIDC token unavailable — the job must set `permissions: id-token: write`."
    );
  }
  const url = new URL(requestUrl);
  if (audience) url.searchParams.set("audience", audience);
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${requestToken}` },
  });
  if (!res.ok) {
    throw new Error(`OIDC token request failed (${res.status})`);
  }
  const data = (await res.json()) as { value: string };
  return data.value;
}

/** Append Markdown to the job summary (`$GITHUB_STEP_SUMMARY`). */
export function appendSummary(markdown: string): void {
  const path = process.env.GITHUB_STEP_SUMMARY;
  if (path) appendFileSync(path, `${markdown}\n`);
}

const COMMENT_MARKER = "<!-- infisicml:diff -->";

/**
 * Upsert a single sticky PR comment carrying the manifest diff. Idempotent: a
 * repeated run edits the existing comment instead of stacking new ones. No-op
 * outside a pull-request event. Uses the REST API over the platform `fetch`.
 */
export async function upsertPrComment(
  token: string,
  markdown: string
): Promise<void> {
  const pr = pullRequestNumber();
  if (pr === undefined) {
    core.info("Not a pull_request event — skipping PR comment.");
    return;
  }
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo) {
    core.warning("GITHUB_REPOSITORY not set — skipping PR comment.");
    return;
  }

  const api = process.env.GITHUB_API_URL ?? "https://api.github.com";
  const body = `${COMMENT_MARKER}\n${markdown}`;
  const headers = {
    authorization: `Bearer ${token}`,
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "content-type": "application/json",
  };

  const listRes = await gh(
    `${api}/repos/${repo}/issues/${pr}/comments?per_page=100`,
    { headers }
  );
  const existing = (await listRes.json()) as Array<{ id: number; body?: string }>;
  const mine = existing.find((c) => c.body?.includes(COMMENT_MARKER));

  if (mine) {
    await gh(`${api}/repos/${repo}/issues/comments/${mine.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ body }),
    });
  } else {
    await gh(`${api}/repos/${repo}/issues/${pr}/comments`, {
      method: "POST",
      headers,
      body: JSON.stringify({ body }),
    });
  }
}

async function gh(url: string, init: RequestInit): Promise<Response> {
  const res = await fetch(url, init);
  if (!res.ok) {
    throw new Error(
      `GitHub API ${init.method ?? "GET"} ${url} failed (${res.status}): ${await res.text()}`
    );
  }
  return res;
}

/** Read the PR number from the event payload (only present on pull_request events). */
function pullRequestNumber(): number | undefined {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) return undefined;
  try {
    const payload = JSON.parse(readFileSync(eventPath, "utf8")) as {
      pull_request?: { number?: number };
    };
    return payload.pull_request?.number;
  } catch {
    return undefined;
  }
}

/** Emit a workflow command on stdout, e.g. `::add-mask::value`. */
function issueCommand(command: string, message: string): void {
  process.stdout.write(`::${command}::${escapeData(message)}\n`);
}

/** Append a `NAME<<delimiter…` block to a file-command file (multiline-safe). */
function writeFileCommand(envVar: string, name: string, value: string): void {
  const path = process.env[envVar];
  if (!path) throw new Error(`${envVar} is not set — not running inside GitHub Actions?`);
  const delimiter = `ghadelimiter_${randomUUID()}`;
  appendFileSync(path, `${name}<<${delimiter}\n${value}\n${delimiter}\n`);
}

function escapeData(value: string): string {
  return value.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}
