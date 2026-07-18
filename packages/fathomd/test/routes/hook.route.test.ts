import { afterEach, describe, expect, it } from "vitest";
import { startTestServer, type TestServer } from "../helpers/testServer.js";

let server: TestServer | undefined;

afterEach(async () => {
  if (server) {
    await server.cleanup();
    server = undefined;
  }
});

describe("POST /hook/{event_name}", () => {
  it("returns the minimal no-op shape and logs the raw payload exactly once", async () => {
    server = await startTestServer();
    const payload = {
      session_id: "abc123",
      hook_event_name: "PreToolUse",
      tool_name: "Read",
      tool_input: { file_path: "docs/fathom-roadmap.md" }
    };
    const res = await server.request("POST", "/hook/PreToolUse", payload);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({});
    expect(server.rawEventLog.count()).toBe(1);
    const latest = server.rawEventLog.latest();
    expect(latest?.event_name).toBe("PreToolUse");
    expect(JSON.parse(latest!.payload_json)).toEqual(payload);
  });

  it("never returns a decision/context-injection field in Phase 0", async () => {
    server = await startTestServer();
    const res = await server.request("POST", "/hook/PostToolUse", { tool_name: "Bash" });
    const body = res.body as Record<string, unknown>;
    expect(body).not.toHaveProperty("decision");
    expect(body).not.toHaveProperty("permissionDecision");
    expect(body).not.toHaveProperty("updatedInput");
    expect(body).not.toHaveProperty("updatedToolOutput");
    expect(body).not.toHaveProperty("hookSpecificOutput");
  });
});

describe("GET/PUT /context", () => {
  it("PUTs an envelope then GETs it back by source_uri", async () => {
    server = await startTestServer();
    const envelope = {
      schema_version: "v1",
      envelope_id: "22222222-2222-2222-2222-222222222222",
      content: "example content",
      source_uri: "file:///docs/example.md",
      origin_layer: "1",
      provenance: "system-authoritative",
      confidence: 0.75,
      timestamp: "2026-07-18T00:00:00.000Z",
      freshness_contract: {}
    };
    const putRes = await server.request("PUT", "/context", envelope);
    expect(putRes.status).toBe(200);

    const getRes = await server.request("GET", `/context/${encodeURIComponent("file:///docs/example.md")}`);
    expect(getRes.status).toBe(200);
    expect((getRes.body as { content: string }).content).toBe("example content");
  });

  it("404s for an unknown source_uri", async () => {
    server = await startTestServer();
    const res = await server.request("GET", `/context/${encodeURIComponent("file:///nope.md")}`);
    expect(res.status).toBe(404);
  });
});
