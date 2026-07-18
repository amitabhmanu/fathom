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
    const result = extractRankInput("Read", { file_path: "docs/foo.md" }, "line one\nline two");
    expect(result.query).toBe("docs/foo.md");
    expect(result.candidates).toEqual([{ source_uri: "docs/foo.md", content: "line one\nline two" }]);
  });

  it("Grep: splits grep -n style output into one candidate per line, keyed by path:line", () => {
    const result = extractRankInput(
      "Grep",
      { pattern: "resolveEndpoint" },
      "packages/fathomd/src/endpoint.ts:12:export function resolveEndpoint(root) {\npackages/fathomd/src/server.ts:5:import http"
    );
    expect(result.query).toBe("resolveEndpoint");
    expect(result.candidates).toEqual([
      { source_uri: "packages/fathomd/src/endpoint.ts:12", content: "packages/fathomd/src/endpoint.ts:12:export function resolveEndpoint(root) {" },
      { source_uri: "packages/fathomd/src/server.ts:5", content: "packages/fathomd/src/server.ts:5:import http" }
    ]);
  });

  it("Glob: treats each bare-path line as its own candidate keyed by that same path", () => {
    const result = extractRankInput(
      "Glob",
      { pattern: "*.ts" },
      "packages/fathomd/src/endpoint.ts\npackages/fathomd/src/server.ts"
    );
    expect(result.query).toBe("*.ts");
    expect(result.candidates).toEqual([
      { source_uri: "packages/fathomd/src/endpoint.ts", content: "packages/fathomd/src/endpoint.ts" },
      { source_uri: "packages/fathomd/src/server.ts", content: "packages/fathomd/src/server.ts" }
    ]);
  });

  it("falls back to a synthetic per-line URI when a line has no recognizable path", () => {
    const result = extractRankInput("Grep", { pattern: "term" }, "some line with no path at all containing term");
    expect(result.candidates).toEqual([
      { source_uri: "grep:term#L0", content: "some line with no path at all containing term" }
    ]);
  });

  it("drops blank lines and returns no candidates for empty output", () => {
    const result = extractRankInput("Grep", { pattern: "term" }, "\n\n   \n");
    expect(result.candidates).toEqual([]);
  });
});
