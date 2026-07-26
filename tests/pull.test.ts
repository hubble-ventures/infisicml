import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InfisicalProvider } from "../src/adapters/infisical.js";
import { pullToFiles } from "../src/commands/pull.js";
import { json, type MockServer, startMockServer } from "./http.js";

let dir: string;
let server: MockServer;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "infisicml-pull-"));
});
afterEach(async () => {
  await server?.close();
  rmSync(dir, { recursive: true, force: true });
});

function write(rel: string, body: string): void {
  const path = join(dir, rel);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, body);
}

async function vault(data: Record<string, Record<string, string>>) {
  return startMockServer(({ url }, res) => {
    const folder = url.searchParams.get("secretPath") ?? "/";
    if (url.pathname === "/api/v3/secrets/raw") {
      const secrets = Object.entries(data[folder] ?? {}).map(
        ([secretKey, secretValue]) => ({ secretKey, secretValue })
      );
      return json(res, 200, { secrets });
    }
    const match = url.pathname.match(/^\/api\/v3\/secrets\/raw\/(.+)$/);
    if (match) {
      const key = decodeURIComponent(match[1] as string);
      const value = data[folder]?.[key];
      if (value === undefined) return json(res, 404, {});
      return json(res, 200, { secret: { secretKey: key, secretValue: value } });
    }
    return json(res, 500, {});
  });
}

describe("pullToFiles", () => {
  it("writes an aliased, sorted, headed dotenv file next to the manifest", async () => {
    write(
      "secrets.yaml",
      `version: 1
project: demo
secrets:
  - path: /app
    keys:
      - { API_KEY: APP_KEY }
      - REGION
`
    );
    server = await vault({ "/app": { API_KEY: "secret", REGION: "us", EXTRA: "x" } });
    const provider = new InfisicalProvider("tok", server.url);

    const outcomes = await pullToFiles({ root: dir, provider });

    expect(outcomes).toEqual([
      { id: ".", output: ".env.secrets", path: join(dir, ".env.secrets"), count: 2 },
    ]);
    const written = readFileSync(join(dir, ".env.secrets"), "utf8");
    expect(written).toContain("# Pulled from Infisical");
    expect(written).toContain("# Environment: development");
    // Sorted, aliased, and the undeclared EXTRA is not leaked.
    expect(written.trimEnd().split("\n").slice(-2)).toEqual([
      "APP_KEY=secret",
      "REGION=us",
    ]);
  });

  it("honors the custom output filename and fetch: keys mode", async () => {
    write(
      "apps/api/secrets.yaml",
      `version: 1
project: demo
defaults:
  output: .env
  fetch: keys
secrets:
  - path: /api
    keys: [TOKEN]
`
    );
    server = await vault({ "/api": { TOKEN: "t" } });
    const provider = new InfisicalProvider("tok", server.url);

    const outcomes = await pullToFiles({ root: dir, provider });
    expect(outcomes[0]).toMatchObject({ id: "apps/api", output: ".env" });
    expect(readFileSync(join(dir, "apps/api/.env"), "utf8")).toContain("TOKEN=t");
    // keys mode ⇒ per-key reads, never a whole-folder fetch.
    expect(server.requests.every((r) => r.pathname.startsWith("/api/v3/secrets/raw/"))).toBe(true);
  });

  it("fails when a required key is missing from the vault", async () => {
    write(
      "secrets.yaml",
      `version: 1
project: demo
secrets:
  - path: /app
    keys: [API_KEY, MISSING]
`
    );
    server = await vault({ "/app": { API_KEY: "v" } });
    const provider = new InfisicalProvider("tok", server.url);

    await expect(pullToFiles({ root: dir, provider })).rejects.toMatchObject({
      issues: [{ code: "missing_key", key: "MISSING" }],
    });
  });
});
