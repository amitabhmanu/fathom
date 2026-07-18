import http from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { readEndpointFile, type FathomEndpoint } from "../../src/index.js";

export function requestOptionsFor(endpoint: FathomEndpoint, method: string, urlPath: string): http.RequestOptions {
  const info = readEndpointFile(endpoint);
  if (!info) throw new Error("endpoint file not written yet");
  if (info.transport === "pipe") {
    return { socketPath: info.address, path: urlPath, method };
  }
  const [host, port] = info.address.split(":");
  return { host, port: Number(port), path: urlPath, method };
}

export function waitForHealth(endpoint: FathomEndpoint, timeoutMs = 8000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      if (!readEndpointFile(endpoint)) {
        retry();
        return;
      }
      const req = http.request(requestOptionsFor(endpoint, "GET", "/health"), (res) => {
        res.resume();
        if (res.statusCode === 200) resolve();
        else retry();
      });
      req.on("error", retry);
      req.end();
    };
    const retry = () => {
      if (Date.now() - start > timeoutMs) reject(new Error("fathomd never became healthy"));
      else setTimeout(attempt, 50);
    };
    attempt();
  });
}

export function postJson(endpoint: FathomEndpoint, urlPath: string, body: unknown): Promise<{ status: number; body: unknown }> {
  const options = requestOptionsFor(endpoint, "POST", urlPath);
  options.headers = { "Content-Type": "application/json" };
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf-8");
        resolve({ status: res.statusCode ?? 0, body: raw ? JSON.parse(raw) : undefined });
      });
    });
    req.on("error", reject);
    req.end(JSON.stringify(body));
  });
}

export function getJson(endpoint: FathomEndpoint, urlPath: string): Promise<{ status: number; body: unknown }> {
  const options = requestOptionsFor(endpoint, "GET", urlPath);
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf-8");
        resolve({ status: res.statusCode ?? 0, body: raw ? JSON.parse(raw) : undefined });
      });
    });
    req.on("error", reject);
    req.end();
  });
}

export function killAndWaitExit(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null) {
      resolve();
      return;
    }
    child.once("exit", () => resolve());
    child.kill();
  });
}

export function spawnDaemon(cliPath: string, projectRoot: string): ChildProcess {
  return spawn(process.execPath, [cliPath, "start"], {
    env: { ...process.env, FATHOM_PROJECT_ROOT: projectRoot }
  });
}
