import { describe, expect, it } from "vitest";
import { redactSensitiveContent, isUsableFormat, isPolicyBlocked } from "../../src/redaction/policyLayer.js";

describe("redactSensitiveContent", () => {
  it("redacts an SSN-shaped pattern and records its type in redactedFields", () => {
    const result = redactSensitiveContent("SSN: 123-45-6789 on file.");
    expect(result.redactedContent).toBe("SSN: [REDACTED-SSN] on file.");
    expect(result.redactedFields).toEqual(["ssn"]);
  });

  it("redacts multiple occurrences", () => {
    const result = redactSensitiveContent("A: 111-22-3333, B: 444-55-6666");
    expect(result.redactedContent).not.toContain("111-22-3333");
    expect(result.redactedContent).not.toContain("444-55-6666");
    expect(result.redactedFields).toEqual(["ssn", "ssn"]);
  });

  it("leaves content unchanged when nothing matches", () => {
    const result = redactSensitiveContent("no sensitive content here");
    expect(result.redactedContent).toBe("no sensitive content here");
    expect(result.redactedFields).toEqual([]);
  });
});

describe("isUsableFormat", () => {
  it("treats normal text as usable", () => {
    expect(isUsableFormat("The quick brown fox jumps over the lazy dog.")).toBe(true);
  });

  it("treats control-character-heavy content as unusable", () => {
    const binaryish = Array.from({ length: 100 }, (_, i) => String.fromCharCode(i % 10)).join("");
    expect(isUsableFormat(binaryish)).toBe(false);
  });

  it("treats empty content as usable (nothing to reject)", () => {
    expect(isUsableFormat("")).toBe(true);
  });
});

describe("isPolicyBlocked", () => {
  it("detects the legal-hold marker", () => {
    expect(isPolicyBlocked("[LEGAL_HOLD] restricted content")).toBe(true);
  });

  it("does not flag ordinary content", () => {
    expect(isPolicyBlocked("ordinary content")).toBe(false);
  });
});
