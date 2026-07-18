import { describe, expect, it } from "vitest";
import { isRankableToolUse, extractRankInput } from "../../src/routes/postToolUseRanking.js";

describe("isRankableToolUse", () => {
  it("accepts Read, Grep, Glob and rejects everything else", () => {
    expect(isRankableToolUse("Read")).toBe(true);
    expect(isRankableToolUse("Grep")).toBe(true);
    expect(isRankableToolUse("Glob")).toBe(true);
    expect(isRankableToolUse("Bash")).toBe(false);
    expect(isRankableToolUse("Edit")).toBe(false);
    expect(isRankableToolUse(undefined)).toBe(false);
  });
});

describe("extractRankInput", () => {
  it("Read: treats the whole file content as one candidate keyed by file_path", () => {
    const result = extractRankInput(
      "Read",
      { file_path: "docs/foo.md" },
      { type: "text", file: { filePath: "docs/foo.md", content: "line one\nline two" } }
    );
    expect(result.query).toBe("docs/foo.md");
    expect(result.candidates).toEqual([{ source_uri: "docs/foo.md", content: "line one\nline two" }]);
  });

  it("Read: no candidates when the response isn't a text read (e.g. an image)", () => {
    const result = extractRankInput("Read", { file_path: "docs/foo.png" }, { type: "image", file: {} });
    expect(result.candidates).toEqual([]);
  });

  it("Grep: splits content-mode output into one candidate per line, keyed by path:line, when a filename prefix is present", () => {
    const result = extractRankInput(
      "Grep",
      { pattern: "resolveEndpoint" },
      {
        mode: "content",
        numFiles: 2,
        filenames: [],
        content:
          "packages/fathomd/src/endpoint.ts:12:export function resolveEndpoint(root) {\npackages/fathomd/src/server.ts:5:import http"
      }
    );
    expect(result.query).toBe("resolveEndpoint");
    expect(result.candidates).toEqual([
      {
        source_uri: "packages/fathomd/src/endpoint.ts:12",
        content: "packages/fathomd/src/endpoint.ts:12:export function resolveEndpoint(root) {"
      },
      { source_uri: "packages/fathomd/src/server.ts:5", content: "packages/fathomd/src/server.ts:5:import http" }
    ]);
  });

  it("Grep: single-file real shape (tool_input.path names one file) has no repeated filename per line — keys off path:lineNumber instead", () => {
    const result = extractRankInput(
      "Grep",
      { pattern: "resolveEndpoint", path: "packages/fathomd/src/endpoint.ts" },
      { mode: "content", numFiles: 0, filenames: [], content: "12:export function resolveEndpoint(root) {\n13-  return root;" }
    );
    expect(result.candidates).toEqual([
      { source_uri: "packages/fathomd/src/endpoint.ts:12", content: "12:export function resolveEndpoint(root) {" },
      { source_uri: "packages/fathomd/src/endpoint.ts:13", content: "13-  return root;" }
    ]);
  });

  it("Grep: files_with_matches/count modes carry no content field and yield no candidates", () => {
    const result = extractRankInput(
      "Grep",
      { pattern: "resolveEndpoint" },
      { mode: "files_with_matches", numFiles: 2, filenames: ["a.ts", "b.ts"] }
    );
    expect(result.candidates).toEqual([]);
  });

  it("Glob: treats each real filenames-array entry as its own candidate keyed by that same path", () => {
    const result = extractRankInput(
      "Glob",
      { pattern: "*.ts" },
      { filenames: ["packages/fathomd/src/endpoint.ts", "packages/fathomd/src/server.ts"], numFiles: 2 }
    );
    expect(result.query).toBe("*.ts");
    expect(result.candidates).toEqual([
      { source_uri: "packages/fathomd/src/endpoint.ts", content: "packages/fathomd/src/endpoint.ts" },
      { source_uri: "packages/fathomd/src/server.ts", content: "packages/fathomd/src/server.ts" }
    ]);
  });

  it("Glob: no candidates for an empty filenames array", () => {
    const result = extractRankInput("Glob", { pattern: "*.ts" }, { filenames: [], numFiles: 0 });
    expect(result.candidates).toEqual([]);
  });

  it("falls back to a synthetic per-line URI when a multi-file-style line has no recognizable path", () => {
    const result = extractRankInput(
      "Grep",
      { pattern: "term" },
      { mode: "content", numFiles: 1, filenames: [], content: "some line with no path at all containing term" }
    );
    expect(result.candidates).toEqual([
      { source_uri: "grep:term#L0", content: "some line with no path at all containing term" }
    ]);
  });

  it("drops blank lines and returns no candidates for empty content", () => {
    const result = extractRankInput("Grep", { pattern: "term" }, { mode: "content", numFiles: 0, filenames: [], content: "\n\n   \n" });
    expect(result.candidates).toEqual([]);
  });
});
