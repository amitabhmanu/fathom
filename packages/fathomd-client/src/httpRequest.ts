import http from "node:http";
import type { EndpointFileContents } from "@fathom/fathomd";

const DEFAULT_TIMEOUT_MS = 2000;

/** Makes a JSON request against a running fathomd, over whichever transport it's actually bound to. */
export function requestJson(
  info: Pick<EndpointFileContents, "transport" | "address">,
  method: string,
  urlPath: string,
  body?: unknown
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? JSON.stringify(body) : undefined;

    let options: http.RequestOptions;
    if (info.transport === "pipe") {
      options = { socketPath: info.address, path: urlPath, method, timeout: DEFAULT_TIMEOUT_MS };
    } else {
      const [host, portStr] = info.address.split(":");
      options = { host, port: Number(portStr), path: urlPath, method, timeout: DEFAULT_TIMEOUT_MS };
    }
    if (payload) {
      options.headers = { "Content-Type": "application/json" };
    }

    const req = http.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf-8");
        try {
          resolve(raw ? JSON.parse(raw) : undefined);
        } catch (err) {
          reject(err as Error);
        }
      });
    });
    req.on("timeout", () => req.destroy(new Error(`request to fathomd timed out: ${method} ${urlPath}`)));
    req.on("error", reject);
    req.end(payload);
  });
}
