import { afterEach, describe, expect, it } from "vitest";
import { InfisicalProvider } from "../src/adapters/infisical.js";
import { json, type MockServer, startMockServer } from "./http.js";

let server: MockServer;
afterEach(() => server?.close());

// A mock Infisical API over a `{ path: { key: value } }` fixture.
async function infisical(data: Record<string, Record<string, string>>) {
  return startMockServer(({ method, url }, res) => {
    if (method === "POST" && url.pathname === "/api/v1/auth/oidc-auth/login") {
      return json(res, 200, { accessToken: "issued-token" });
    }
    const folder = url.searchParams.get("secretPath") ?? "/";
    if (url.pathname === "/api/v3/secrets/raw") {
      const secrets = Object.entries(data[folder] ?? {}).map(
        ([secretKey, secretValue]) => ({ secretKey, secretValue })
      );
      return json(res, 200, { secrets });
    }
    const match = url.pathname.match(/^\/api\/v3\/secrets\/raw\/(.+)$/);
    if (match) {
      const key = decodeURIComponent(match[1] as string);
      const value = data[folder]?.[key];
      if (value === undefined) return json(res, 404, { message: "not found" });
      return json(res, 200, { secret: { secretKey: key, secretValue: value } });
    }
    return json(res, 500, { message: `unexpected ${url.pathname}` });
  });
}

describe("InfisicalProvider", () => {
  it("exchanges an OIDC JWT for a token and uses it as a bearer", async () => {
    server = await infisical({ "/app": { API_KEY: "v" } });
    const provider = await InfisicalProvider.loginWithOidc(
      "identity-1",
      "the-jwt",
      server.url
    );
    await provider.fetchFolder("proj", "development", "/app");

    const login = server.requests[0];
    expect(login?.method).toBe("POST");
    expect(login?.pathname).toBe("/api/v1/auth/oidc-auth/login");
    expect(JSON.parse(login?.body ?? "{}")).toEqual({
      identityId: "identity-1",
      jwt: "the-jwt",
    });
    expect(server.requests[1]?.headers.authorization).toBe(
      "Bearer issued-token"
    );
  });

  it("reads a whole folder with the right query params", async () => {
    server = await infisical({ "/app": { API_KEY: "v", REGION: "us" } });
    const provider = new InfisicalProvider("tok", server.url);
    const out = await provider.fetchFolder("acme", "production", "/app");

    expect(out).toEqual({ API_KEY: "v", REGION: "us" });
    const req = server.requests[0];
    expect(req?.search.get("workspaceSlug")).toBe("acme");
    expect(req?.search.get("environment")).toBe("production");
    expect(req?.search.get("secretPath")).toBe("/app");
  });

  it("lists keys without values", async () => {
    server = await infisical({ "/app": { API_KEY: "v", REGION: "us" } });
    const provider = new InfisicalProvider("tok", server.url);
    expect(await provider.listKeys("acme", "development", "/app")).toEqual([
      "API_KEY",
      "REGION",
    ]);
  });

  it("fetches only the requested keys and omits 404s (least privilege)", async () => {
    server = await infisical({ "/app": { API_KEY: "v", OTHER: "x" } });
    const provider = new InfisicalProvider("tok", server.url);
    const out = await provider.fetchKeys("acme", "development", "/app", [
      "API_KEY",
      "ABSENT",
    ]);

    expect(out).toEqual({ API_KEY: "v" });
    // One request per requested key, never a whole-folder read.
    const paths = server.requests.map((r) => r.pathname);
    expect(paths).toEqual([
      "/api/v3/secrets/raw/API_KEY",
      "/api/v3/secrets/raw/ABSENT",
    ]);
  });

  it("throws on a non-OK response", async () => {
    server = await startMockServer((_req, res) =>
      json(res, 500, { message: "boom" })
    );
    const provider = new InfisicalProvider("tok", server.url);
    await expect(
      provider.fetchFolder("acme", "development", "/app")
    ).rejects.toThrow(/500/);
  });
});
