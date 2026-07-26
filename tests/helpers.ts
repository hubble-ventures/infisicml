import type { Manifest, SecretsProvider } from "../src/core/index.js";

/** A minimal valid manifest, overridable per test. */
export function manifest(overrides: Partial<Manifest> = {}): Manifest {
  return {
    version: 1,
    project: "demo",
    secrets: [{ path: "/app", keys: ["API_KEY"] }],
    ...overrides,
  } as Manifest;
}

/**
 * In-memory {@link SecretsProvider} over a `{ path: { key: value } }` fixture.
 * Records every call so tests can assert least-privilege reads.
 */
export class FakeVault implements SecretsProvider {
  readonly reads: Array<{ method: string; path: string; keys?: string[] }> = [];

  constructor(private readonly data: Record<string, Record<string, string>>) {}

  async fetchFolder(
    _project: string,
    _environment: string,
    path: string
  ): Promise<Record<string, string>> {
    this.reads.push({ method: "fetchFolder", path });
    return { ...(this.data[path] ?? {}) };
  }

  async listKeys(
    _project: string,
    _environment: string,
    path: string
  ): Promise<string[]> {
    this.reads.push({ method: "listKeys", path });
    return Object.keys(this.data[path] ?? {});
  }

  async fetchKeys(
    _project: string,
    _environment: string,
    path: string,
    keys: string[]
  ): Promise<Record<string, string>> {
    this.reads.push({ method: "fetchKeys", path, keys });
    const folder = this.data[path] ?? {};
    const out: Record<string, string> = {};
    for (const key of keys) if (key in folder) out[key] = folder[key] as string;
    return out;
  }
}
