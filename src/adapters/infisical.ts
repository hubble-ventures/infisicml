import type { SecretsProvider } from "../core/types.js";

const DEFAULT_API_URL = "https://app.infisical.com";

/** Resolve the Infisical API base URL (env override → cloud default). */
export function resolveApiUrl(): string {
  return process.env.INFISICAL_API_URL ?? DEFAULT_API_URL;
}

type RawSecret = { secretKey: string; secretValue: string };

/**
 * {@link SecretsProvider} backed by the Infisical REST API, using the platform's
 * native `fetch` (no HTTP dependency).
 *
 * Authentication is a bearer token. Get one via {@link loginWithOidc} (the CI
 * lane) or pass an existing token (local dev, `INFISICAL_TOKEN`).
 */
export class InfisicalProvider implements SecretsProvider {
  constructor(
    private readonly token: string,
    private readonly baseUrl: string = resolveApiUrl()
  ) {}

  /**
   * Exchange a GitHub OIDC JWT for an Infisical access token via a machine
   * identity bound to the OIDC auth method. No long-lived credential is stored.
   */
  static async loginWithOidc(
    identityId: string,
    jwt: string,
    baseUrl: string = resolveApiUrl()
  ): Promise<InfisicalProvider> {
    const res = await fetch(`${baseUrl}/api/v1/auth/oidc-auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identityId, jwt }),
    });
    if (!res.ok) {
      throw new Error(
        `Infisical OIDC login failed (${res.status}): ${await res.text()}`
      );
    }
    const data = (await res.json()) as { accessToken: string };
    return new InfisicalProvider(data.accessToken, baseUrl);
  }

  async fetchFolder(
    project: string,
    environment: string,
    path: string
  ): Promise<Record<string, string>> {
    return this.readFolder(project, environment, path);
  }

  async listKeys(
    project: string,
    environment: string,
    path: string
  ): Promise<string[]> {
    return Object.keys(await this.readFolder(project, environment, path));
  }

  /**
   * Least-privilege read: request each declared key individually so the vault
   * never transmits the rest of the folder. Absent keys (404) are omitted.
   */
  async fetchKeys(
    project: string,
    environment: string,
    path: string,
    keys: string[]
  ): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    await Promise.all(
      keys.map(async (key) => {
        const url = this.secretUrl(project, environment, path, key);
        const res = await fetch(url, { headers: this.authHeaders() });
        if (res.status === 404) return;
        if (!res.ok) {
          throw new Error(
            `Infisical read failed for ${path}:${key} (${res.status}): ${await res.text()}`
          );
        }
        const data = (await res.json()) as { secret: RawSecret };
        out[key] = data.secret.secretValue;
      })
    );
    return out;
  }

  private async readFolder(
    project: string,
    environment: string,
    path: string
  ): Promise<Record<string, string>> {
    const url = new URL(`${this.baseUrl}/api/v3/secrets/raw`);
    url.searchParams.set("workspaceSlug", project);
    url.searchParams.set("environment", environment);
    url.searchParams.set("secretPath", path);
    const res = await fetch(url, { headers: this.authHeaders() });
    if (!res.ok) {
      throw new Error(
        `Infisical read failed for ${path} (${res.status}): ${await res.text()}`
      );
    }
    const data = (await res.json()) as { secrets: RawSecret[] };
    const out: Record<string, string> = {};
    for (const secret of data.secrets) out[secret.secretKey] = secret.secretValue;
    return out;
  }

  private secretUrl(
    project: string,
    environment: string,
    path: string,
    key: string
  ): URL {
    const url = new URL(
      `${this.baseUrl}/api/v3/secrets/raw/${encodeURIComponent(key)}`
    );
    url.searchParams.set("workspaceSlug", project);
    url.searchParams.set("environment", environment);
    url.searchParams.set("secretPath", path);
    return url;
  }

  private authHeaders(): Record<string, string> {
    return { authorization: `Bearer ${this.token}` };
  }
}
