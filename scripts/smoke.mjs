// End-to-end smoke of the built CLI (dist/cli.js) with no live Infisical:
// exercises the offline lanes — list, tier-1 validate, and diff against a git
// ref. Run via `pnpm smoke` (which builds first).
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "cli.js");
const dir = mkdtempSync(join(tmpdir(), "infisicml-smoke-"));

const git = (...args) => execFileSync("git", args, { cwd: dir, stdio: "pipe" });
const cli = (...args) => {
  try {
    return {
      code: 0,
      out: execFileSync("node", [CLI, ...args], { cwd: dir, encoding: "utf8" }),
    };
  } catch (error) {
    return { code: error.status ?? 1, out: `${error.stdout ?? ""}${error.stderr ?? ""}` };
  }
};

const assert = (cond, msg) => {
  if (!cond) {
    console.error(`✗ ${msg}`);
    rmSync(dir, { recursive: true, force: true });
    process.exit(1);
  }
  console.log(`✓ ${msg}`);
};

const BASE = `version: 1
project: demo
secrets:
  - path: /app
    keys: [API_KEY, DATABASE_URL]
`;
const CHANGED = `version: 1
project: demo
secrets:
  - path: /app
    keys: [API_KEY, REDIS_URL]
`;

try {
  git("init", "-q");
  git("config", "user.email", "smoke@test.local");
  git("config", "user.name", "smoke");
  writeFileSync(join(dir, "secrets.yaml"), BASE);
  git("add", "-A");
  git("commit", "-qm", "base");

  assert(cli("list").out.includes("secrets.yaml"), "list finds the manifest");
  assert(cli("validate").code === 0, "validate passes on a good manifest");

  // Break the schema → tier-1 validate must fail.
  writeFileSync(join(dir, "secrets.yaml"), "version: 1\nproject: demo\n");
  assert(cli("validate").code === 1, "validate fails on an invalid manifest");

  // Change the secret surface → diff must report and exit non-zero.
  writeFileSync(join(dir, "secrets.yaml"), CHANGED);
  const diff = cli("diff", "--base", "HEAD");
  assert(diff.code === 1, "diff exits non-zero when the surface changed");
  assert(diff.out.includes("REDIS_URL"), "diff shows the added variable");
  assert(diff.out.includes("DATABASE_URL"), "diff shows the removed variable");

  // Restore → diff is clean.
  writeFileSync(join(dir, "secrets.yaml"), BASE);
  assert(cli("diff", "--base", "HEAD").code === 0, "diff is clean when unchanged");

  // An invalid base ref is rejected, not treated as an all-new diff.
  const badBase = cli("diff", "--base", "no-such-ref-xyz");
  assert(
    badBase.code === 1 && /Unknown base ref/.test(badBase.out),
    "diff rejects an unknown base ref"
  );

  console.log("\nSmoke passed.");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
