import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { startTestServer, type TestServer } from "../helpers/testServer.js";

let server: TestServer | undefined;

afterEach(async () => {
  if (server) {
    await server.cleanup();
    server = undefined;
  }
});

function seedEnvelope(sourceUri: string, content: string) {
  return {
    schema_version: "v1",
    envelope_id: "11111111-1111-1111-1111-111111111111",
    content,
    content_hash: createHash("sha256").update(content).digest("hex"),
    source_uri: sourceUri,
    origin_layer: "1",
    provenance: "system-authoritative",
    confidence: 0.9,
    timestamp: "2026-07-18T00:00:00.000Z",
    freshness_contract: { half_life_seconds: 3600 }
  };
}

describe("FileChanged -> PreToolUse two-hop drift (Phase 5 exit criterion)", () => {
  it("FileChanged only marks-dirty-and-logs (no decision fields at all)", async () => {
    server = await startTestServer();
    const filePath = path.join(server.endpoint.projectRoot, "watched.md");
    fs.writeFileSync(filePath, "original content");
    await server.request("PUT", "/context", seedEnvelope(filePath, "original content"));

    fs.writeFileSync(filePath, "edited content after a real change");
    const res = await server.request("POST", "/hook/FileChanged", {
      hook_event_name: "FileChanged",
      file_path: filePath
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({});

    const drift = server.driftStore.unresolvedFor(filePath);
    expect(drift).toBeTruthy();
    expect(drift?.signal_type).toBe("content-edited");
    expect(drift?.re_entry_layer).toBe("2");
  });

  it("a subsequent PreToolUse on the same source surfaces the drift and runs the full cascade down to 1", async () => {
    server = await startTestServer();
    const filePath = path.join(server.endpoint.projectRoot, "watched2.md");
    fs.writeFileSync(filePath, "original content");
    await server.request("PUT", "/context", seedEnvelope(filePath, "original content"));

    const editedContent = "edited content after a real change";
    fs.writeFileSync(filePath, editedContent);
    await server.request("POST", "/hook/FileChanged", { hook_event_name: "FileChanged", file_path: filePath });

    // Single-hook tests would be testing a capability FileChanged doesn't have — the real
    // surfacing only happens here, at the next decision-capable hook.
    const res = await server.request("POST", "/hook/PreToolUse", {
      hook_event_name: "PreToolUse",
      tool_name: "Read",
      tool_input: { file_path: filePath }
    });

    expect(res.status).toBe(200);
    const body = res.body as { hookSpecificOutput?: { additionalContext?: string } };
    expect(body.hookSpecificOutput?.additionalContext).toMatch(/content-edited/);
    expect(body.hookSpecificOutput?.additionalContext).toMatch(/Refreshed layers: 2, 1/);

    // Behavioral proof the cascade actually ran: the stored envelope's hash now matches
    // the fresh content, not the original.
    const stored = server.envelopeStore.getBySourceUri(filePath);
    const refreshed = stored.find((e) => e.content_hash === createHash("sha256").update(editedContent).digest("hex"));
    expect(refreshed).toBeTruthy();

    expect(server.driftStore.unresolvedFor(filePath)).toBeNull();
  });

  it("a PreToolUse on an unrelated source with no drift stays a silent no-op", async () => {
    server = await startTestServer();
    const res = await server.request("POST", "/hook/PreToolUse", {
      hook_event_name: "PreToolUse",
      tool_name: "Read",
      tool_input: { file_path: "file:///totally-unrelated.md" }
    });
    expect(res.body).toEqual({});
  });
});

describe("ConfigChange -> PreToolUse two-hop drift (Phase 5 exit criterion)", () => {
  it("ConfigChange only marks-dirty-and-logs (no decision fields — real capability is block-only, and blocking would be too disruptive)", async () => {
    server = await startTestServer();
    const res = await server.request("POST", "/hook/ConfigChange", {
      hook_event_name: "ConfigChange",
      matcher: "policy_settings"
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({});

    const drift = server.driftStore.unresolvedFor("*");
    expect(drift?.signal_type).toBe("policy-changed");
    expect(drift?.re_entry_layer).toBe("3");
  });

  it("the next PreToolUse call (regardless of target source) surfaces the global policy-changed drift", async () => {
    server = await startTestServer();
    await server.request("POST", "/hook/ConfigChange", { hook_event_name: "ConfigChange", matcher: "policy_settings" });

    const res = await server.request("POST", "/hook/PreToolUse", {
      hook_event_name: "PreToolUse",
      tool_name: "Read",
      tool_input: { file_path: "file:///anything.md" }
    });

    const body = res.body as { hookSpecificOutput?: { additionalContext?: string } };
    expect(body.hookSpecificOutput?.additionalContext).toMatch(/policy-changed/);
    expect(server.driftStore.unresolvedFor("*")).toBeNull();
  });
});

describe("PostToolUseFailure routes not-found as source-moved drift (Phase 5 completes the Phase 3 deferral)", () => {
  it("surfaces additionalContext in a single hop (PostToolUseFailure supports it directly)", async () => {
    server = await startTestServer();
    const res = await server.request("POST", "/hook/PostToolUseFailure", {
      hook_event_name: "PostToolUseFailure",
      tool_name: "Read",
      tool_input: { file_path: "system://moved-doc.md" },
      tool_error: "404 Not Found: system://moved-doc.md"
    });

    expect(res.status).toBe(200);
    const body = res.body as { hookSpecificOutput?: { additionalContext?: string } };
    expect(body.hookSpecificOutput?.additionalContext).toMatch(/moved or been renamed/);

    const drift = server.driftStore.tail(5).find((d) => d.signal_type === "source-moved");
    expect(drift?.re_entry_layer).toBe("4");
    // Single-hop: PostToolUseFailure both detected AND surfaced it already.
    expect(drift?.resolved).toBe(0);
  });
});

describe("UserPromptSubmit routes an intent shift as query-intent-shifted drift (Phase 5 exit criterion)", () => {
  it("surfaces additionalContext when the new prompt shares little overlap with the last ranked query", async () => {
    server = await startTestServer();
    server.rankingLog.append("resolveEndpoint pipe name", 0.08, [
      { source_uri: "file:///a.ts", score: 0.9, rank: 0 }
    ]);

    const res = await server.request("POST", "/hook/UserPromptSubmit", {
      hook_event_name: "UserPromptSubmit",
      user_message: "actually let's talk about something completely different now, like weekend plans"
    });

    expect(res.status).toBe(200);
    const body = res.body as { hookSpecificOutput?: { additionalContext?: string } };
    expect(body.hookSpecificOutput?.additionalContext).toMatch(/shifted intent/);

    const drift = server.driftStore.tail(5).find((d) => d.signal_type === "query-intent-shifted");
    expect(drift?.re_entry_layer).toBe("1");
  });

  it("stays a silent no-op when the new prompt still overlaps with the last ranked query", async () => {
    server = await startTestServer();
    server.rankingLog.append("resolveEndpoint pipe name", 0.08, [
      { source_uri: "file:///a.ts", score: 0.9, rank: 0 }
    ]);

    const res = await server.request("POST", "/hook/UserPromptSubmit", {
      hook_event_name: "UserPromptSubmit",
      user_message: "can you show me the resolveEndpoint pipe name logic again"
    });

    expect(res.body).toEqual({});
  });
});

describe("fathom_elicit routes a contradicting re-answer as fact-changed drift (Phase 5 exit criterion)", () => {
  it("records fact-changed drift when the same question gets a materially different answer later", async () => {
    server = await startTestServer();
    await server.request("POST", "/elicit", {
      question: "Why did we choose vendor X over Y?",
      human_answer: "Cost reasons, decided in Q2."
    });

    const secondRes = await server.request("POST", "/elicit", {
      question: "Why did we choose vendor X over Y?",
      human_answer: "Actually it was a security compliance requirement, not cost."
    });
    expect(secondRes.status).toBe(200);

    const drift = server.driftStore.tail(5).find((d) => d.signal_type === "fact-changed");
    expect(drift?.re_entry_layer).toBe("5");
  });

  it("does not record drift when re-eliciting the same question with the same answer", async () => {
    server = await startTestServer();
    await server.request("POST", "/elicit", { question: "Same question?", human_answer: "Same answer." });
    await server.request("POST", "/elicit", { question: "Same question?", human_answer: "Same answer." });

    const drift = server.driftStore.tail(5).find((d) => d.signal_type === "fact-changed");
    expect(drift).toBeUndefined();
  });
});
