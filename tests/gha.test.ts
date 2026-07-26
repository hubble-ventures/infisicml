import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  appendSummary,
  core,
  exportSecrets,
  getOidcToken,
  upsertPrComment,
} from "../src/adapters/gha.js";
import { json, type MockServer, startMockServer } from "./http.js";

let dir: string;
let server: MockServer | undefined;
const saved = { ...process.env };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "infisicml-gha-"));
  process.env.GITHUB_ENV = join(dir, "env");
  process.env.GITHUB_OUTPUT = join(dir, "out");
  process.env.GITHUB_STEP_SUMMARY = join(dir, "summary");
  writeFileSync(process.env.GITHUB_ENV, "");
  writeFileSync(process.env.GITHUB_OUTPUT, "");
  writeFileSync(process.env.GITHUB_STEP_SUMMARY, "");
});

afterEach(async () => {
  await server?.close();
  server = undefined;
  rmSync(dir, { recursive: true, force: true });
  process.env = { ...saved };
});

describe("inputs", () => {
  it("reads, trims, and maps input names to INPUT_* env", () => {
    process.env.INPUT_COMMAND = "  pull  ";
    process.env["INPUT_CHECK-VALUES"] = "true";
    expect(core.getInput("command")).toBe("pull");
    expect(core.getBooleanInput("check-values")).toBe(true);
    expect(core.getBooleanInput("missing")).toBe(false);
  });

  it("throws when a required input is absent", () => {
    expect(() => core.getInput("nope", { required: true })).toThrow(/nope/);
  });
});

describe("exportSecrets", () => {
  it("masks each value and writes a multiline-safe GITHUB_ENV block", () => {
    const writes: string[] = [];
    const spy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk: string | Uint8Array) => {
        writes.push(String(chunk));
        return true;
      });

    exportSecrets({ API_KEY: "s3cr3t" });
    spy.mockRestore();

    expect(writes.join("")).toContain("::add-mask::s3cr3t");
    const env = readFileSync(process.env.GITHUB_ENV as string, "utf8");
    expect(env).toMatch(/^API_KEY<<ghadelimiter_.+\ns3cr3t\nghadelimiter_.+\n$/);
  });
});

describe("setOutput / appendSummary", () => {
  it("writes outputs to GITHUB_OUTPUT", () => {
    core.setOutput("changed", true);
    expect(readFileSync(process.env.GITHUB_OUTPUT as string, "utf8")).toMatch(
      /^changed<<ghadelimiter_.+\ntrue\n/
    );
  });

  it("appends markdown to the job summary", () => {
    appendSummary("## hello");
    expect(
      readFileSync(process.env.GITHUB_STEP_SUMMARY as string, "utf8")
    ).toContain("## hello");
  });
});

describe("getOidcToken", () => {
  it("requests the token with the audience and request bearer", async () => {
    server = await startMockServer((_req, res) =>
      json(res, 200, { value: "id-jwt" })
    );
    process.env.ACTIONS_ID_TOKEN_REQUEST_URL = `${server.url}/token`;
    process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN = "request-token";

    expect(await getOidcToken("my-audience")).toBe("id-jwt");
    const req = server.requests[0];
    expect(req?.search.get("audience")).toBe("my-audience");
    expect(req?.headers.authorization).toBe("Bearer request-token");
  });

  it("throws a helpful error when OIDC is not enabled", async () => {
    delete process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
    delete process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
    await expect(getOidcToken()).rejects.toThrow(/id-token: write/);
  });
});

describe("upsertPrComment", () => {
  function eventFile(payload: unknown): void {
    const path = join(dir, "event.json");
    writeFileSync(path, JSON.stringify(payload));
    process.env.GITHUB_EVENT_PATH = path;
    process.env.GITHUB_REPOSITORY = "acme/app";
  }

  it("creates a comment when none exists", async () => {
    const bodies: string[] = [];
    server = await startMockServer(({ method, url, body }, res) => {
      if (method === "GET") return json(res, 200, []);
      if (method === "POST") {
        bodies.push(body);
        return json(res, 201, {});
      }
      return json(res, 500, {});
    });
    process.env.GITHUB_API_URL = server.url;
    eventFile({ pull_request: { number: 7 } });

    await upsertPrComment("gh-token", "## diff");
    const created = server.requests.find((r) => r.method === "POST");
    expect(created?.pathname).toBe("/repos/acme/app/issues/7/comments");
    expect(bodies[0]).toContain("infisicml:diff");
  });

  it("updates the existing sticky comment instead of stacking", async () => {
    server = await startMockServer(({ method }, res) => {
      if (method === "GET") {
        return json(res, 200, [
          { id: 99, body: "<!-- infisicml:diff -->\nold" },
        ]);
      }
      return json(res, 200, {});
    });
    process.env.GITHUB_API_URL = server.url;
    eventFile({ pull_request: { number: 7 } });

    await upsertPrComment("gh-token", "## new diff");
    const patch = server.requests.find((r) => r.method === "PATCH");
    expect(patch?.pathname).toBe("/repos/acme/app/issues/comments/99");
  });

  it("is a no-op outside a pull_request event", async () => {
    server = await startMockServer((_req, res) => json(res, 200, []));
    process.env.GITHUB_API_URL = server.url;
    eventFile({}); // no pull_request

    await upsertPrComment("gh-token", "## diff");
    expect(server.requests).toHaveLength(0);
  });
});
