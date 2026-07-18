import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { spawn, type ChildProcess } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { resolveEndpoint, readEndpointFile, openDb, RawEventLog, type FathomEndpoint } from "../src/index.js";

const here = fileURLToPath(new URL(".", import.meta.url));
const cliPath = path.resolve(here, "..", "dist", "cli.js");

function requestOptionsFor(endpoint: FathomEndpoint, method: string, urlPath: string): http.RequestOptions {
  const info = readEndpointFile(endpoint);
  if (!info) throw new Error("endpoint file not written yet");
  if (info.transport === "pipe") {
    return { socketPath: info.address, path: urlPath, method };
  }
  const [host, port] = info.address.split(":");
  return { host, port: Number(port), path: urlPath, method };
}

function waitForHealth(endpoint: FathomEndpoint, timeoutMs = 8000): Promise<void> {
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

function postJson(endpoint: FathomEndpoint, urlPath: string, body: unknown): Promise<void> {
  const options = requestOptionsFor(endpoint, "POST", urlPath);
  options.headers = { "Content-Type": "application/json" };
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      res.resume();
      resolve();
    });
    req.on("error", reject);
    req.end(JSON.stringify(body));
  });
}

function killAndWaitExit(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null) {
      resolve();
      return;
    }
    child.once("exit", () => resolve());
    child.kill();
  });
}

describe("fathomd daemon restart persistence (Phase 0 exit criterion)", () => {
  let projectRoot: string | undefined;
  let child: ChildProcess | undefined;

  afterEach(async () => {
    if (child) {
      await killAndWaitExit(child);
      child = undefined;
    }
    if (projectRoot) {
      fs.rmSync(projectRoot, { recursive: true, force: true });
      projectRoot = undefined;
    }
  });

  it("keeps raw_events across a real process kill + restart against the same db file", async () => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fathomd-restart-test-"));
    const endpoint = resolveEndpoint(projectRoot);

    // First daemon lifetime: start, write one event, kill.
    child = spawn(process.execPath, [cliPath, "start"], {
      env: { ...process.env, FATHOM_PROJECT_ROOT: projectRoot }
    });
    await waitForHealth(endpoint);
    await postJson(endpoint, "/hook/PreToolUse", { hook_event_name: "PreToolUse", tool_name: "Read" });
    await killAndWaitExit(child);
    child = undefined;

    const dbAfterFirstLife = openDb(endpoint.dbPath);
    const logAfterFirstLife = new RawEventLog(dbAfterFirstLife);
    expect(logAfterFirstLife.count()).toBe(1);
    expect(logAfterFirstLife.latest()?.event_name).toBe("PreToolUse");
    dbAfterFirstLife.close();

    // Second daemon lifetime, same project root/db file: must open the existing db
    // without error (proves the restart itself works) and the row must still be there.
    child = spawn(process.execPath, [cliPath, "start"], {
      env: { ...process.env, FATHOM_PROJECT_ROOT: projectRoot }
    });
    await waitForHealth(endpoint);
    await killAndWaitExit(child);
    child = undefined;

    const dbAfterRestart = openDb(endpoint.dbPath);
    const logAfterRestart = new RawEventLog(dbAfterRestart);
    expect(logAfterRestart.count()).toBe(1);
    expect(logAfterRestart.latest()?.event_name).toBe("PreToolUse");
    dbAfterRestart.close();
  }, 20000);
});
