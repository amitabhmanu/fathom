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

describe("preToolUse hook shim (compiled, real subprocess)", () => {
  it.each(["preToolUse.read.json", "preToolUse.bash.json"])(
    "returns the minimal no-op shape and logs %s raw, unchanged",
    async (fixtureName) => {
      daemon = await startTestDaemon();
      // The fixture's cwd is a realistic placeholder; runHook routes on the payload's own
      // cwd field (see runHook.ts), so it must be overridden to this test's real daemon root.
      const fixture = { ...(loadFixture(fixtureName) as Record<string, unknown>), cwd: daemon.endpoint.projectRoot };

      const result = await runCompiledHookShim("preToolUse", fixture, {
        ...process.env,
        FATHOM_PROJECT_ROOT: daemon.endpoint.projectRoot
      });

      expect(result.stderr).toBe("");
      const parsed = JSON.parse(result.stdout);
      expect(parsed).toEqual({});
      expect(parsed).not.toHaveProperty("permissionDecision");
      expect(parsed).not.toHaveProperty("updatedInput");
      expect(parsed).not.toHaveProperty("hookSpecificOutput");

      expect(daemon.rawEventLog.count()).toBe(1);
      const latest = daemon.rawEventLog.latest();
      expect(latest?.event_name).toBe("PreToolUse");
      expect(JSON.parse(latest!.payload_json)).toEqual(fixture);
    }
  );
});
