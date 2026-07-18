import { describe, expect, it } from "vitest";
import { buildSubagentTask } from "../../src/delegate/subagentTask.js";

describe("buildSubagentTask", () => {
  it("produces a subagent_task string with enough scope info to act on", () => {
    const content = "x".repeat(5000);
    const result = buildSubagentTask(content, "file:///huge-multi-file-read.md", 100);
    expect(result.subagent_task).toContain("file:///huge-multi-file-read.md");
    expect(result.subagent_task).toContain("100");
    expect(result.subagent_task.length).toBeGreaterThan(20);
  });

  it("produces a well-formed, non-empty expected_return_shape", () => {
    const result = buildSubagentTask("x".repeat(5000), "file:///x.md", 100);
    expect(typeof result.expected_return_shape).toBe("string");
    expect(result.expected_return_shape.length).toBeGreaterThan(10);
  });
});
