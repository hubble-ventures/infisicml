import { describe, expect, it } from "vitest";
import { normalizePath, resolveOutputPath } from "../src/core/index.js";

describe("normalizePath", () => {
  it("adds a leading slash and trims a trailing one", () => {
    expect(normalizePath("app/sub/")).toBe("/app/sub");
    expect(normalizePath("/app")).toBe("/app");
  });

  it("collapses to root", () => {
    expect(normalizePath("/")).toBe("/");
    expect(normalizePath("")).toBe("/");
  });
});

describe("resolveOutputPath", () => {
  it("resolves a bare filename next to the manifest", () => {
    expect(resolveOutputPath("/repo/app", ".env")).toBe("/repo/app/.env");
  });

  it("rejects path separators and traversal", () => {
    expect(() => resolveOutputPath("/repo/app", "../.env")).toThrow();
    expect(() => resolveOutputPath("/repo/app", "sub/.env")).toThrow();
  });
});
