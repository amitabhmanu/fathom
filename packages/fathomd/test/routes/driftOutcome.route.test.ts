import { afterEach, describe, expect, it } from "vitest";
import { startTestServer, type TestServer } from "../helpers/testServer.js";

let server: TestServer | undefined;

afterEach(async () => {
  if (server) {
    await server.cleanup();
    server = undefined;
  }
});

describe("POST /drift/outcome (Phase 6 threshold self-tuning)", () => {
  it("raises a layer's threshold on repeated false-positive outcomes, clamped to the layer's safe bounds", async () => {
    server = await startTestServer();

    let last: { new_threshold: number } | undefined;
    for (let i = 0; i < 6; i++) {
      const res = await server.request("POST", "/drift/outcome", { layer: "4", outcome: "false-positive" });
      expect(res.status).toBe(200);
      last = res.body as { new_threshold: number };
    }

    // Layer 4 default is 0.7, +0.02 per call, bounds max 0.9 — 6 calls should land at 0.82.
    expect(last?.new_threshold).toBeCloseTo(0.82, 5);
  });

  it("lowers a layer's threshold on a false-negative outcome", async () => {
    server = await startTestServer();
    const res = await server.request("POST", "/drift/outcome", { layer: "1", outcome: "false-negative" });
    const body = res.body as { previous_threshold: number; new_threshold: number };
    expect(body.previous_threshold).toBeCloseTo(0.3, 5);
    expect(body.new_threshold).toBeCloseTo(0.28, 5);
  });

  it("400s when layer or outcome is missing", async () => {
    server = await startTestServer();
    const res = await server.request("POST", "/drift/outcome", { layer: "1" });
    expect(res.status).toBe(400);
  });

  it("a tuned-up threshold actually suppresses a drift signal that would otherwise have triggered", async () => {
    server = await startTestServer();

    // Baseline: source-moved fires at confidence 0.8 against the layer-4 default (0.7).
    const baseline = await server.request("POST", "/hook/PostToolUseFailure", {
      hook_event_name: "PostToolUseFailure",
      tool_name: "Read",
      tool_input: { file_path: "system://moved-doc.md" },
      tool_error: "404 Not Found: system://moved-doc.md"
    });
    const baselineBody = baseline.body as { hookSpecificOutput?: { additionalContext?: string } };
    expect(baselineBody.hookSpecificOutput?.additionalContext).toMatch(/moved or been renamed/);

    // Tune layer 4's threshold up past 0.8 via repeated false-positive outcomes (0.7 -> 0.82).
    for (let i = 0; i < 6; i++) {
      await server.request("POST", "/drift/outcome", { layer: "4", outcome: "false-positive" });
    }

    const after = await server.request("POST", "/hook/PostToolUseFailure", {
      hook_event_name: "PostToolUseFailure",
      tool_name: "Read",
      tool_input: { file_path: "system://another-moved-doc.md" },
      tool_error: "404 Not Found: system://another-moved-doc.md"
    });
    expect(after.body).toEqual({});

    const driftEvents = server.driftStore.tail(10).filter((e) => e.signal_type === "source-moved");
    expect(driftEvents.some((e) => e.source_uri === "system://moved-doc.md")).toBe(true);
    expect(driftEvents.some((e) => e.source_uri === "system://another-moved-doc.md")).toBe(false);
  });

  it("never pushes a threshold past its layer's safe bounds, no matter how many outcomes are applied", async () => {
    server = await startTestServer();

    let last: { new_threshold: number } | undefined;
    for (let i = 0; i < 50; i++) {
      const res = await server.request("POST", "/drift/outcome", { layer: "4", outcome: "false-positive" });
      last = res.body as { new_threshold: number };
    }
    // Layer 4's safe bounds max out at 0.9 (see tuning.ts's DEFAULT_BOUNDS) — 50 consecutive
    // false-positive outcomes must still clamp there, not overshoot.
    expect(last?.new_threshold).toBeCloseTo(0.9, 5);

    for (let i = 0; i < 50; i++) {
      const res = await server.request("POST", "/drift/outcome", { layer: "4", outcome: "false-negative" });
      last = res.body as { new_threshold: number };
    }
    expect(last?.new_threshold).toBeCloseTo(0.5, 5);
  });
});
