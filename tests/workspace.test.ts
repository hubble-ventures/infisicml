import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discoverManifests, loadManifest } from "../src/adapters/workspace.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "infisicml-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(rel: string, body: string): void {
  const path = join(root, rel);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, body);
}

const VALID = "version: 1\nproject: demo\nsecrets:\n  - path: /app\n    keys: [API_KEY]\n";

describe("discoverManifests", () => {
  it("finds manifests by id, sorted, skipping ignored dirs", () => {
    write("secrets.yaml", VALID);
    write("apps/api/secrets.yaml", VALID);
    write("node_modules/pkg/secrets.yaml", VALID);

    const found = discoverManifests(root);
    expect(found.map((f) => f.id)).toEqual([".", "apps/api"]);
  });

  it("throws on two manifest files in one directory", () => {
    write("secrets.yaml", VALID);
    write("secrets.yml", VALID);
    expect(() => discoverManifests(root)).toThrow(/Ambiguous/);
  });

  it("loads and validates a manifest", () => {
    write("secrets.yaml", VALID);
    const [file] = discoverManifests(root);
    expect(loadManifest(file!).project).toBe("demo");
  });
});
