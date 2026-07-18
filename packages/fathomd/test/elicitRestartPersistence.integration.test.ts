import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type ChildProcess } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { resolveEndpoint } from "../src/index.js";
import { waitForHealth, postJson, getJson, killAndWaitExit, spawnDaemon } from "./helpers/realDaemonProcess.js";

const here = fileURLToPath(new URL(".", import.meta.url));
const cliPath = path.resolve(here, "..", "dist", "cli.js");

describe("layer-5 elicited-answer write-back survives a real daemon restart (Phase 4 exit criterion)", () => {
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

  it("an elicited answer given in one daemon lifetime is retrievable as a layer-5 envelope after a fresh SessionStart in the next", async () => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fathomd-elicit-restart-test-"));
    const endpoint = resolveEndpoint(projectRoot);

    // First daemon lifetime: elicit an answer, then kill (simulating the session ending).
    child = spawnDaemon(cliPath, projectRoot);
    await waitForHealth(endpoint);
    const elicitRes = await postJson(endpoint, "/elicit", {
      question: "Why did we choose vendor X over Y?",
      human_answer: "Decided in the Q2 vendor review meeting for cost reasons."
    });
    expect(elicitRes.status).toBe(200);
    const elicitBody = elicitRes.body as {
      ok: true;
      content: string;
      provenance: string;
      source_uri: string;
    };
    expect(elicitBody.ok).toBe(true);
    expect(elicitBody.provenance).toBe("human-confirmed");
    expect(elicitBody.source_uri).toMatch(/^fathom:\/\/elicited\//);

    await killAndWaitExit(child);
    child = undefined;

    // Second daemon lifetime (a fresh SessionStart for a new session): the elicited
    // envelope must still be retrievable by the exact source_uri the first lifetime
    // returned — proving write-back survived the restart, not just the process's memory.
    child = spawnDaemon(cliPath, projectRoot);
    await waitForHealth(endpoint);
    const sessionStartRes = await postJson(endpoint, "/hook/SessionStart", {
      hook_event_name: "SessionStart",
      source: "startup"
    });
    expect(sessionStartRes.status).toBe(200);

    const getRes = await getJson(endpoint, `/context/${encodeURIComponent(elicitBody.source_uri)}`);
    expect(getRes.status).toBe(200);
    const envelope = getRes.body as { content: string; provenance: string; origin_layer: string };
    expect(envelope.content).toBe("Decided in the Q2 vendor review meeting for cost reasons.");
    expect(envelope.provenance).toBe("human-confirmed");
    expect(envelope.origin_layer).toBe("5");
  }, 20000);
});
