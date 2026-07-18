import { afterEach, describe, expect, it } from "vitest";
import { startTestServer, type TestServer } from "../helpers/testServer.js";

let server: TestServer | undefined;

afterEach(async () => {
  if (server) {
    await server.cleanup();
    server = undefined;
  }
});

/**
 * Regression coverage for a real bug found by inspecting actual captured PostToolUse
 * payloads from a live Claude Code session: every fixture and hand-written implementation
 * assumed a flat `tool_output: string` field, which no real hook payload has ever had —
 * the real field is `tool_response`, shaped differently per tool. These tests use payload
 * shapes transcribed directly from real captured raw_events rather than hand-waved guesses.
 */
describe("PostToolUse real tool_response shapes (regression: tool_output never existed)", () => {
  it("Read: a real {type:'text', file:{content}} response populates ranking_metadata", async () => {
    server = await startTestServer();
    const res = await server.request("POST", "/hook/PostToolUse", {
      hook_event_name: "PostToolUse",
      tool_name: "Read",
      tool_input: { file_path: "C:\\repo\\docs\\notes.md" },
      // Content deliberately overlaps with the query (the file_path itself, per Read's
      // extractQuery) so it clears rank()'s relevance cutoff, same as every other real
      // Read fixture in this suite.
      tool_response: {
        type: "text",
        file: { filePath: "C:\\repo\\docs\\notes.md", content: "these are some real notes about the repo" }
      }
    });
    expect(res.status).toBe(200);

    const envRes = await server.request("GET", `/context/${encodeURIComponent("C:\\repo\\docs\\notes.md")}`);
    expect(envRes.status).toBe(200);
    expect((envRes.body as { ranking_metadata?: unknown }).ranking_metadata).toBeTruthy();
  });

  it("Grep: a real single-file content-mode response (numbered lines, no filename prefix) resolves source_uri to {path}:{line}", async () => {
    server = await startTestServer();
    // Transcribed from a real captured payload: when tool_input.path names one file, Grep's
    // content lines are bare "N:text"/"N-text" with no repeated filename per line.
    const res = await server.request("POST", "/hook/PostToolUse", {
      hook_event_name: "PostToolUse",
      tool_name: "Grep",
      tool_input: { pattern: "Phase 5", path: "C:\\repo\\docs\\fathom-roadmap.md", output_mode: "content" },
      tool_response: {
        mode: "content",
        numFiles: 0,
        filenames: [],
        content: "130:## Phase 5 — Drift detection and the layer router\n131-\n132-**Goal:** staleness gets detected."
      }
    });
    expect(res.status).toBe(200);

    const matched = await server.request(
      "GET",
      `/context/${encodeURIComponent("C:\\repo\\docs\\fathom-roadmap.md:130")}`
    );
    expect(matched.status).toBe(200);
  });

  it("Grep: files_with_matches mode (no content field) produces zero ranked candidates, not a crash", async () => {
    server = await startTestServer();
    const res = await server.request("POST", "/hook/PostToolUse", {
      hook_event_name: "PostToolUse",
      tool_name: "Grep",
      tool_input: { pattern: "something" },
      tool_response: { mode: "files_with_matches", numFiles: 2, filenames: ["a.ts", "b.ts"] }
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({});
  });

  it("Glob: a real {filenames:[...]} response (no content field at all) produces one ranked candidate per filename", async () => {
    server = await startTestServer();
    const res = await server.request("POST", "/hook/PostToolUse", {
      hook_event_name: "PostToolUse",
      tool_name: "Glob",
      tool_input: { pattern: "*.ts" },
      tool_response: { filenames: ["src/a.ts", "src/b.ts"], numFiles: 2, truncated: false }
    });
    expect(res.status).toBe(200);

    const first = await server.request("GET", `/context/${encodeURIComponent("src/a.ts")}`);
    const second = await server.request("GET", `/context/${encodeURIComponent("src/b.ts")}`);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
  });

  it("a control/meta tool (TaskUpdate) with an arbitrary tool_response object is a silent no-op, not a crash or a guessed fit", async () => {
    server = await startTestServer();
    const res = await server.request("POST", "/hook/PostToolUse", {
      hook_event_name: "PostToolUse",
      tool_name: "TaskUpdate",
      tool_input: { taskId: "1", status: "completed" },
      tool_response: { success: true, taskId: "1", updatedFields: ["status"] }
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({});
  });

  it("Bash: real {stdout, stderr} response runs through layer-2 fit() when oversized", async () => {
    server = await startTestServer();
    const bigStdout = "line of build output ".repeat(200);
    const res = await server.request("POST", "/hook/PostToolUse", {
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      tool_input: { command: "npm run build" },
      tool_response: { stdout: bigStdout, stderr: "", interrupted: false }
    });
    expect(res.status).toBe(200);
    const body = res.body as { hookSpecificOutput?: { updatedToolOutput?: string } };
    expect(body.hookSpecificOutput?.updatedToolOutput).toBeTruthy();
  });
});
