import { describe, expect, it } from "vitest";
import {
  compile,
  validateAgainstVault,
  validateStructure,
} from "../src/core/index.js";
import { FakeVault, manifest } from "./helpers.js";

describe("validateStructure (tier 1)", () => {
  it("returns no issues for a valid manifest", () => {
    expect(validateStructure(manifest())).toEqual([]);
  });

  it("reports schema errors with a path", () => {
    const issues = validateStructure({ version: 1 });
    expect(issues.some((i) => i.code === "schema")).toBe(true);
  });

  it("rejects unknown top-level keys", () => {
    const issues = validateStructure({ ...manifest(), bogus: true });
    expect(issues.length).toBeGreaterThan(0);
  });

  it("reports duplicate target variables", () => {
    const issues = validateStructure(
      manifest({
        secrets: [
          { path: "/a", keys: ["TOKEN"] },
          { path: "/b", keys: [{ SRC: "TOKEN" }] },
        ],
      })
    );
    expect(issues.some((i) => i.code === "duplicate_target")).toBe(true);
  });
});

describe("validateAgainstVault (tiers 2/3)", () => {
  it("flags a declared key missing from the vault", async () => {
    const compiled = compile(
      manifest({ secrets: [{ path: "/app", keys: ["API_KEY", "MISSING"] }] })
    );
    const vault = new FakeVault({ "/app": { API_KEY: "v" } });
    const issues = await validateAgainstVault(compiled, vault);
    expect(issues).toContainEqual(
      expect.objectContaining({ code: "missing_in_vault", key: "MISSING" })
    );
  });

  it("warns about undeclared vault drift", async () => {
    const compiled = compile(
      manifest({ secrets: [{ path: "/app", keys: ["API_KEY"] }] })
    );
    const vault = new FakeVault({ "/app": { API_KEY: "v", EXTRA: "y" } });
    const issues = await validateAgainstVault(compiled, vault);
    expect(issues).toContainEqual(
      expect.objectContaining({ code: "undeclared_in_vault", key: "EXTRA", level: "warning" })
    );
  });

  it("flags empty required values only when checkValues is set", async () => {
    const compiled = compile(
      manifest({ secrets: [{ path: "/app", keys: ["API_KEY"] }] })
    );
    const vault = new FakeVault({ "/app": { API_KEY: "" } });
    expect(await validateAgainstVault(compiled, vault)).not.toContainEqual(
      expect.objectContaining({ code: "empty_value" })
    );
    const withValues = await validateAgainstVault(compiled, vault, {
      checkValues: true,
    });
    expect(withValues).toContainEqual(
      expect.objectContaining({ code: "empty_value", key: "API_KEY" })
    );
  });
});
