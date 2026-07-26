import { describe, expect, it } from "vitest";
import {
  compile,
  diffCompiled,
  isEmptyDelta,
  renderDeltaMarkdown,
  renderDeltaText,
} from "../src/core/index.js";
import { manifest } from "./helpers.js";

const base = compile(
  manifest({
    secrets: [{ path: "/app", keys: ["KEEP", "REMOVE_ME", { OLD: "MOVED" }] }],
  })
);
const head = compile(
  manifest({
    secrets: [
      { path: "/app", keys: ["KEEP", "ADDED"] },
      { path: "/other", keys: [{ NEW: "MOVED" }] },
    ],
  })
);

describe("diffCompiled", () => {
  const delta = diffCompiled(base, head);

  it("detects additions", () => {
    expect(delta.added.map((b) => b.targetVar)).toEqual(["ADDED"]);
  });

  it("detects removals", () => {
    expect(delta.removed.map((b) => b.targetVar)).toEqual(["REMOVE_ME"]);
  });

  it("detects a moved source under the same variable", () => {
    expect(delta.changed).toHaveLength(1);
    expect(delta.changed[0]).toMatchObject({
      targetVar: "MOVED",
      from: { path: "/app", sourceKey: "OLD" },
      to: { path: "/other", sourceKey: "NEW" },
    });
  });

  it("is empty for identical manifests", () => {
    expect(isEmptyDelta(diffCompiled(base, base))).toBe(true);
  });

  it("reports setting changes", () => {
    const other = compile(
      manifest({ defaults: { output: ".env.local" } })
    );
    const delta = diffCompiled(compile(manifest()), other);
    expect(delta.settings).toContainEqual({
      field: "output",
      from: ".env.secrets",
      to: ".env.local",
    });
  });
});

describe("renderers", () => {
  it("renders markdown with a counts line", () => {
    const md = renderDeltaMarkdown(diffCompiled(base, head), "pkg");
    expect(md).toContain("### pkg");
    expect(md).toContain("`ADDED`");
    expect(md).toContain("1 added · 1 removed · 1 changed");
  });

  it("renders empty deltas succinctly", () => {
    expect(renderDeltaText(diffCompiled(base, base))).toBe(
      "No secret manifest changes."
    );
  });
});
