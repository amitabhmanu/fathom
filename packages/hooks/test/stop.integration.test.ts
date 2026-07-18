import { afterEach, describe, expect, it } from "vitest";
import { startTestDaemon, type TestDaemon } from "./helpers/testDaemon.js";
import { runCompiledHookShim } from "./helpers/runShim.js";
import { loadFixture } from "./helpers/loadFixture.js";

let daemon: TestDaemon | undefined;

afterEach(async () => {
  if (daemon) {
    await daemon.cleanup();
    daemon = undefined;
  }
});

describe("stop hook shim (compiled, real subprocess)", () => {
  it("returns the minimal no-op shape and logs the fixture raw, unchanged", async () => {
    daemon = await startTestDaemon();
    // The fixture's cwd is a realistic placeholder; runHook routes on the payload's own
    // cwd field (see runHook.ts), so it must be overridden to this test's real daemon root.
    const fixture = { ...(loadFixture("stop.basic.json") as Record<string, unknown>), cwd: daemon.endpoint.projectRoot };

    const result = await runCompiledHookShim("stop", fixture, {
      ...process.env,
      FATHOM_PROJECT_ROOT: daemon.endpoint.projectRoot
    });

    expect(result.stderr).toBe("");
    const parsed = JSON.parse(result.stdout);
    expect(parsed).toEqual({});
    expect(parsed).not.toHaveProperty("decision");

    expect(daemon.rawEventLog.count()).toBe(1);
    const latest = daemon.rawEventLog.latest();
    expect(latest?.event_name).toBe("Stop");
    expect(JSON.parse(latest!.payload_json)).toEqual(fixture);
  });
});
