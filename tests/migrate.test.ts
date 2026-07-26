import { describe, expect, it } from "vitest";
import { compile, manifestSchema } from "../src/core/index.js";
import { migrateV2 } from "../src/migrate/v2.js";

describe("migrateV2", () => {
  it("flattens a nested folder tree into paths", () => {
    const { manifest } = migrateV2(
      {
        secrets: [
          { clerk: ["CLERK_PUBLISHABLE_KEY"] },
          { app: ["API_KEY", { sub: ["NESTED_KEY"] }] },
        ],
      },
      { project: "acme" }
    );
    const paths = manifest.secrets.map((b) => ({ path: b.path, keys: b.keys }));
    expect(paths).toEqual([
      { path: "/clerk", keys: ["CLERK_PUBLISHABLE_KEY"] },
      { path: "/app", keys: ["API_KEY"] },
      { path: "/app/sub", keys: ["NESTED_KEY"] },
    ]);
  });

  it("preserves aliases and splits multi-alias objects", () => {
    const { manifest } = migrateV2(
      {
        secrets: [
          { clerk: [{ CLERK_PUBLISHABLE_KEY: "VITE_CLERK_PUBLISHABLE_KEY" }] },
          { multi: [{ A: "X", B: "Y" }] },
        ],
      },
      { project: "acme" }
    );
    expect(manifest.secrets[0]?.keys).toEqual([
      { CLERK_PUBLISHABLE_KEY: "VITE_CLERK_PUBLISHABLE_KEY" },
    ]);
    expect(manifest.secrets[1]?.keys).toEqual([{ A: "X" }, { B: "Y" }]);
  });

  it("moves output/fetch under defaults and renames optionalKeys", () => {
    const { manifest, warnings } = migrateV2(
      {
        output: ".env.local",
        fetch: "keys",
        secrets: [{ app: ["API_KEY", "DEBUG"] }],
        environments: { production: { optionalKeys: ["DEBUG"] } },
      },
      { project: "acme" }
    );
    expect(manifest.defaults).toEqual({ output: ".env.local", fetch: "keys" });
    expect(manifest.environments).toEqual({ production: { optional: ["DEBUG"] } });
    expect(warnings.some((w) => w.includes("optional"))).toBe(true);
  });

  it("maps profiles, flattening their trees", () => {
    const { manifest } = migrateV2(
      {
        secrets: [{ app: ["API_KEY"] }],
        profiles: { deploy: { fetch: "keys", secrets: [{ ci: ["DEPLOY_KEY"] }] } },
      },
      { project: "acme" }
    );
    expect(manifest.profiles?.deploy).toEqual({
      fetch: "keys",
      secrets: [{ path: "/ci", keys: ["DEPLOY_KEY"] }],
    });
  });

  it("warns about the dropped ci block", () => {
    const { warnings } = migrateV2(
      {
        secrets: [{ app: ["API_KEY"] }],
        ci: { stubInCi: true, skipWhenEnv: ["API_KEY"] },
      },
      { project: "acme" }
    );
    expect(warnings.some((w) => w.includes("ci"))).toBe(true);
  });

  it("produces a manifest that passes the v3 schema and compiles", () => {
    const { manifest } = migrateV2(
      {
        $schema: "old",
        secrets: [
          { clerk: [{ CLERK_PUBLISHABLE_KEY: "VITE_CLERK_PUBLISHABLE_KEY" }] },
          { shared: ["DATABASE_URL"] },
        ],
      },
      { project: "acme" }
    );
    expect(() => manifestSchema.parse(manifest)).not.toThrow();
    // compile sorts by path first: /clerk before /shared.
    const compiled = compile(manifest);
    expect(compiled.bindings.map((b) => b.targetVar)).toEqual([
      "VITE_CLERK_PUBLISHABLE_KEY",
      "DATABASE_URL",
    ]);
  });
});
