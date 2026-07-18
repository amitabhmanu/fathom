import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { startTestServer, type TestServer } from "../helpers/testServer.js";

const here = fileURLToPath(new URL(".", import.meta.url));
const fixturesDir = path.resolve(here, "..", "..", "..", "..", "fixtures", "hooks");

function loadFixture(name: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(fixturesDir, name), "utf-8"));
}

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

describe("PostToolUse layer-1 ranking (Phase 1 exit criteria)", () => {
  it("Read: populates ranking_metadata on the stored envelope", async () => {
    server = await startTestServer();
    const fixture = loadFixture("postToolUse.read.json");
    const res = await server.request("POST", "/hook/PostToolUse", fixture);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({});

    const getRes = await server.request(
      "GET",
      `/context/${encodeURIComponent("docs/fathom-roadmap.md")}`
    );
    expect(getRes.status).toBe(200);
    const envelope = getRes.body as { ranking_metadata?: { query: string; score: number; rank: number; retriever: string } };
    expect(envelope.ranking_metadata).toBeTruthy();
    expect(envelope.ranking_metadata!.query).toBe("docs/fathom-roadmap.md");
    expect(envelope.ranking_metadata!.rank).toBe(0);
  });

  it("Grep: splits multi-candidate output into ranked envelopes, best match first", async () => {
    server = await startTestServer();
    const fixture = loadFixture("postToolUse.grep.multiCandidate.json");
    const res = await server.request("POST", "/hook/PostToolUse", fixture);
    expect(res.status).toBe(200);

    const exactMatch = await server.request(
      "GET",
      `/context/${encodeURIComponent("packages/fathomd/src/endpoint.ts:12")}`
    );
    expect(exactMatch.status).toBe(200);
    const exactEnvelope = exactMatch.body as { ranking_metadata: { rank: number; score: number } };
    expect(exactEnvelope.ranking_metadata.rank).toBe(0);

    // The second line never mentions "resolveEndpoint" at all, so its hybrid score falls
    // below the relevance cutoff and it's correctly dropped rather than stored — the
    // layer-1 "relevance threshold" solution component from the layers doc working as intended.
    const noMatch = await server.request(
      "GET",
      `/context/${encodeURIComponent("packages/fathomd/src/server.ts:5")}`
    );
    expect(noMatch.status).toBe(404);
  });

  it("Glob: each bare-path output line becomes its own ranked envelope", async () => {
    server = await startTestServer();
    const fixture = loadFixture("postToolUse.glob.json");
    const res = await server.request("POST", "/hook/PostToolUse", fixture);
    expect(res.status).toBe(200);

    const first = await server.request(
      "GET",
      `/context/${encodeURIComponent("packages/fathomd/src/endpoint.ts")}`
    );
    const second = await server.request(
      "GET",
      `/context/${encodeURIComponent("packages/fathomd/src/server.ts")}`
    );
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect((first.body as { ranking_metadata?: unknown }).ranking_metadata).toBeTruthy();
    expect((second.body as { ranking_metadata?: unknown }).ranking_metadata).toBeTruthy();
  });

  it("logs a ranking event queryable by source_uri via RankingLog", async () => {
    server = await startTestServer();
    const fixture = loadFixture("postToolUse.grep.multiCandidate.json");
    await server.request("POST", "/hook/PostToolUse", fixture);

    const history = server.rankingLog.forSourceUri("packages/fathomd/src/endpoint.ts:12");
    expect(history.length).toBe(1);
    expect(history[0].query).toBe("resolveEndpoint");
  });
});
