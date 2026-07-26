import { describe, expect, it } from "vitest";
import { compile, materialize } from "../src/core/index.js";
import { FakeVault, manifest } from "./helpers.js";

describe("materialize", () => {
  it("fetches whole folders in folder mode and aliases locally", async () => {
    const compiled = compile(
      manifest({
        secrets: [{ path: "/app", keys: [{ API_KEY: "APP_KEY" }, "REGION"] }],
      })
    );
    const vault = new FakeVault({
      "/app": { API_KEY: "secret", REGION: "us", UNUSED: "x" },
    });
    const out = await materialize(compiled, vault);
    expect(out).toEqual({ APP_KEY: "secret", REGION: "us" });
    expect(vault.reads).toEqual([{ method: "fetchFolder", path: "/app" }]);
  });

  it("reads only declared keys in keys mode (least privilege)", async () => {
    const compiled = compile(
      manifest({
        defaults: { fetch: "keys" },
        secrets: [{ path: "/app", keys: ["API_KEY"] }],
      })
    );
    const vault = new FakeVault({ "/app": { API_KEY: "v", OTHER: "y" } });
    await materialize(compiled, vault);
    expect(vault.reads).toEqual([
      { method: "fetchKeys", path: "/app", keys: ["API_KEY"] },
    ]);
  });

  it("throws with every missing required key at once", async () => {
    const compiled = compile(
      manifest({ secrets: [{ path: "/app", keys: ["A", "B"] }] })
    );
    const vault = new FakeVault({ "/app": {} });
    await expect(materialize(compiled, vault)).rejects.toMatchObject({
      issues: [{ key: "A" }, { key: "B" }],
    });
  });

  it("allows an optional key to be absent", async () => {
    const compiled = compile(
      manifest({
        secrets: [{ path: "/app", keys: ["API_KEY", "DEBUG"] }],
        environments: { development: { optional: ["DEBUG"] } },
      })
    );
    const vault = new FakeVault({ "/app": { API_KEY: "v" } });
    const out = await materialize(compiled, vault);
    expect(out).toEqual({ API_KEY: "v" });
  });
});
