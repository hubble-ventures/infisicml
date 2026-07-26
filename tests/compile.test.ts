import { describe, expect, it } from "vitest";
import { compile, ManifestError } from "../src/core/index.js";
import { manifest } from "./helpers.js";

describe("compile", () => {
  it("flattens blocks into sorted bindings", () => {
    const compiled = compile(
      manifest({
        secrets: [
          { path: "/b", keys: ["Z_KEY", "A_KEY"] },
          { path: "/a", keys: ["M_KEY"] },
        ],
      })
    );
    expect(compiled.bindings.map((b) => `${b.path}:${b.targetVar}`)).toEqual([
      "/a:M_KEY",
      "/b:A_KEY",
      "/b:Z_KEY",
    ]);
  });

  it("applies aliases from a single-pair map", () => {
    const compiled = compile(
      manifest({ secrets: [{ path: "/app", keys: [{ SRC: "DEST" }] }] })
    );
    expect(compiled.bindings[0]).toMatchObject({
      path: "/app",
      sourceKey: "SRC",
      targetVar: "DEST",
    });
  });

  it("normalizes folder paths", () => {
    const compiled = compile(
      manifest({ secrets: [{ path: "/app/", keys: ["K"] }] })
    );
    expect(compiled.bindings[0]?.path).toBe("/app");
  });

  it("marks environment-optional keys optional", () => {
    const compiled = compile(
      manifest({
        secrets: [{ path: "/app", keys: ["API_KEY", "DEBUG"] }],
        environments: { production: { optional: ["DEBUG"] } },
      }),
      { environment: "production" }
    );
    const byVar = Object.fromEntries(
      compiled.bindings.map((b) => [b.targetVar, b.optional])
    );
    expect(byVar).toEqual({ API_KEY: false, DEBUG: true });
  });

  it("throws on a duplicate target variable", () => {
    expect(() =>
      compile(
        manifest({
          secrets: [
            { path: "/a", keys: ["TOKEN"] },
            { path: "/b", keys: [{ OTHER: "TOKEN" }] },
          ],
        })
      )
    ).toThrowError(ManifestError);
  });

  it("throws on an unknown profile", () => {
    expect(() => compile(manifest(), { profile: "nope" })).toThrowError(
      /Unknown profile/
    );
  });

  it("rejects a multi-key alias object instead of dropping extras", () => {
    expect(() =>
      compile(manifest({ secrets: [{ path: "/a", keys: [{ A: "X", B: "Y" }] }] }))
    ).toThrowError(ManifestError);
  });

  it("resolves a profile's secrets and fetch mode", () => {
    const compiled = compile(
      manifest({
        profiles: {
          deploy: { secrets: [{ path: "/ci", keys: ["DEPLOY_KEY"] }], fetch: "keys" },
        },
      }),
      { profile: "deploy" }
    );
    expect(compiled.fetch).toBe("keys");
    expect(compiled.bindings).toHaveLength(1);
    expect(compiled.bindings[0]?.sourceKey).toBe("DEPLOY_KEY");
  });
});
