import { describe, expect, it } from "vitest";
import { extractToolResponseContent } from "../../src/routes/toolResponseContent.js";

describe("extractToolResponseContent (guards against the tool_output:string assumption)", () => {
  it("Read: pulls content from the real {type, file:{content}} shape, not a flat string", () => {
    const real = { type: "text", file: { filePath: "a.md", content: "hello world" } };
    expect(extractToolResponseContent("Read", real)).toBe("hello world");
  });

  it("Read: returns undefined for a non-text response (e.g. an image read) rather than guessing", () => {
    expect(extractToolResponseContent("Read", { type: "image", file: {} })).toBeUndefined();
  });

  it("Grep: pulls content only in content mode", () => {
    const real = { mode: "content", numFiles: 1, filenames: [], content: "12:matched line" };
    expect(extractToolResponseContent("Grep", real)).toBe("12:matched line");
  });

  it("Grep: files_with_matches/count modes carry no per-line text and yield undefined", () => {
    expect(extractToolResponseContent("Grep", { mode: "files_with_matches", filenames: ["a.ts"] })).toBeUndefined();
    expect(extractToolResponseContent("Grep", { mode: "count", filenames: [] })).toBeUndefined();
  });

  it("Glob: joins the real filenames array rather than expecting a flat newline string", () => {
    const real = { filenames: ["a.ts", "b.ts"], numFiles: 2, truncated: false };
    expect(extractToolResponseContent("Glob", real)).toBe("a.ts\nb.ts");
  });

  it("Glob: undefined for an empty result, not an empty string", () => {
    expect(extractToolResponseContent("Glob", { filenames: [], numFiles: 0 })).toBeUndefined();
  });

  it("Write: pulls content from the real {type, filePath, content} shape", () => {
    expect(extractToolResponseContent("Write", { type: "create", filePath: "a.md", content: "new file" })).toBe(
      "new file"
    );
  });

  it("Bash/PowerShell: pulls stdout", () => {
    expect(extractToolResponseContent("Bash", { stdout: "output", stderr: "", interrupted: false })).toBe("output");
    expect(extractToolResponseContent("PowerShell", { stdout: "ps output", stderr: "" })).toBe("ps output");
  });

  it("WebFetch: pulls the result field", () => {
    expect(extractToolResponseContent("WebFetch", { bytes: 100, code: 200, result: "fetched text" })).toBe(
      "fetched text"
    );
  });

  it("Edit: no natural single content string (only a diff + pre-edit snapshot) — undefined, not a guess", () => {
    const real = { filePath: "a.md", oldString: "x", newString: "y", originalFile: "x context" };
    expect(extractToolResponseContent("Edit", real)).toBeUndefined();
  });

  it("unrecognized/control tools (e.g. TaskUpdate) return undefined rather than stringifying arbitrary metadata", () => {
    expect(extractToolResponseContent("TaskUpdate", { success: true, taskId: "1" })).toBeUndefined();
  });

  it("never throws on a missing or non-object tool_response", () => {
    expect(extractToolResponseContent("Read", undefined)).toBeUndefined();
    expect(extractToolResponseContent("Read", null)).toBeUndefined();
    expect(extractToolResponseContent("Read", "a plain string")).toBeUndefined();
  });
});
