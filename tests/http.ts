import {
  createServer,
  type IncomingHttpHeaders,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";

export type RecordedRequest = {
  method: string;
  pathname: string;
  search: URLSearchParams;
  headers: IncomingHttpHeaders;
  body: string;
};

export type MockRequest = {
  method: string;
  url: URL;
  body: string;
};

export type MockServer = {
  url: string;
  requests: RecordedRequest[];
  close: () => Promise<void>;
};

/**
 * Start an in-process HTTP server on a random port. `handler` inspects the
 * parsed request and writes the response; every request is recorded so tests can
 * assert the exact wire calls a subject made.
 */
export async function startMockServer(
  handler: (req: MockRequest, res: ServerResponse) => void
): Promise<MockServer> {
  const requests: RecordedRequest[] = [];
  const server = createServer((raw, res) => {
    const chunks: Buffer[] = [];
    raw.on("data", (chunk) => chunks.push(chunk));
    raw.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      const url = new URL(raw.url ?? "/", "http://localhost");
      requests.push({
        method: raw.method ?? "",
        pathname: url.pathname,
        search: url.searchParams,
        headers: raw.headers,
        body,
      });
      handler({ method: raw.method ?? "", url, body }, res);
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve()))
      ),
  };
}

export function json(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(data));
}
