import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type ChildProcess } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { resolveEndpoint, openDb, RawEventLog } from "../src/index.js";
import { waitForHealth, postJson, killAndWaitExit, spawnDaemon } from "./helpers/realDaemonProcess.js";

const here = fileURLToPath(new URL(".", import.meta.url));
const cliPath = path.resolve(here, "..", "dist", "cli.js");

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
    child = spawnDaemon(cliPath, projectRoot);
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
    child = spawnDaemon(cliPath, projectRoot);
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
