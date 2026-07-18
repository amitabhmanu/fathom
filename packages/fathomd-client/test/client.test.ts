import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveEndpoint } from "@fathom/fathomd";
import { ensureDaemonRunning, postHook, type EnsureDaemonDeps } from "../src/client.js";
import { startRunningTestDaemon, type RunningTestDaemon } from "./helpers/testServer.js";

function fakeDeps(overrides: Partial<EnsureDaemonDeps> = {}): EnsureDaemonDeps {
  return {
    checkHealth: vi.fn().mockResolvedValue(true),
    spawnDaemon: vi.fn(),
    sleep: vi.fn().mockResolvedValue(undefined),
    ...overrides
  };
}

describe("ensureDaemonRunning", () => {
  it("does not spawn when the daemon is already healthy", async () => {
    const endpoint = resolveEndpoint("C:/fake/project/a");
    const deps = fakeDeps({ checkHealth: vi.fn().mockResolvedValue(true) });
    await ensureDaemonRunning(endpoint, {}, deps);
    expect(deps.spawnDaemon).not.toHaveBeenCalled();
  });

  it("spawns exactly once when the first health check fails but a later one succeeds", async () => {
    const endpoint = resolveEndpoint("C:/fake/project/b");
    const checkHealth = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const deps = fakeDeps({ checkHealth });
    await ensureDaemonRunning(endpoint, { maxSpawnRetries: 5, retryDelayMs: 1 }, deps);
    expect(deps.spawnDaemon).toHaveBeenCalledTimes(1);
    expect(checkHealth).toHaveBeenCalledTimes(3);
  });

  it("throws if the daemon never becomes healthy within the retry budget", async () => {
    const endpoint = resolveEndpoint("C:/fake/project/c");
    const deps = fakeDeps({ checkHealth: vi.fn().mockResolvedValue(false) });
    await expect(
      ensureDaemonRunning(endpoint, { maxSpawnRetries: 3, retryDelayMs: 1 }, deps)
    ).rejects.toThrow(/did not become healthy/);
    expect(deps.spawnDaemon).toHaveBeenCalledTimes(1);
  });
});

describe("postHook", () => {
  let daemon: RunningTestDaemon | undefined;

  afterEach(async () => {
    if (daemon) {
      await daemon.cleanup();
      daemon = undefined;
    }
  });

  it("round-trips a payload byte-for-byte against a real running fathomd", async () => {
    daemon = await startRunningTestDaemon();
    const payload = {
      session_id: "abc123",
      hook_event_name: "PreToolUse",
      tool_name: "Read",
      tool_input: { file_path: "docs/fathom-roadmap.md" }
    };
    const result = await postHook("PreToolUse", payload, { projectRoot: daemon.endpoint.projectRoot });
    expect(result).toEqual({});
    expect(daemon.rawEventLog.count()).toBe(1);
    expect(JSON.parse(daemon.rawEventLog.latest()!.payload_json)).toEqual(payload);
  });
});
