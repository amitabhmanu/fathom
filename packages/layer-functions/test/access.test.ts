import { describe, expect, it } from "vitest";
import { access } from "../src/access.js";

const GRANTED_CTX = { available_grants: ["read-only:tickets"], requesting_scope: "read-only:tickets" };

describe("access", () => {
  it("denies with escalation_required when the requesting scope isn't in available_grants", () => {
    const result = access({
      source_uri: "system://tickets/42",
      content: "plain ticket text",
      credential_ctx: { available_grants: ["read-only:other-scope"], requesting_scope: "read-only:tickets" }
    });
    expect(result).toEqual({ kind: "denied", reason: "credentials", escalation_required: true });
  });

  it("denies as a format issue when content looks unusable (binary/control-character heavy)", () => {
    const binaryish = Array.from({ length: 200 }, (_, i) => String.fromCharCode(i % 20)).join("");
    const result = access({ source_uri: "system://scan.pdf", content: binaryish, credential_ctx: GRANTED_CTX });
    expect(result).toEqual({ kind: "denied", reason: "format", escalation_required: false });
  });

  it("denies as a policy block for content under legal hold, distinct from redaction-and-grant", () => {
    const result = access({
      source_uri: "system://legal/case-1",
      content: "[LEGAL_HOLD] this document is under active litigation hold",
      credential_ctx: GRANTED_CTX
    });
    expect(result).toEqual({ kind: "denied", reason: "policy", escalation_required: false });
  });

  it("grants with redaction when sensitive fields are present but permitted", () => {
    const result = access({
      source_uri: "system://tickets/42",
      content: "Customer SSN is 123-45-6789, please process the refund.",
      credential_ctx: GRANTED_CTX
    });
    expect(result.kind).toBe("granted");
    if (result.kind === "granted") {
      expect(result.envelope.content).not.toContain("123-45-6789");
      expect(result.envelope.content).toContain("[REDACTED-SSN]");
      expect(result.envelope.access_provenance?.redacted_fields).toEqual(["ssn"]);
      expect(result.envelope.provenance).toBe("redacted");
    }
  });

  it("grants without redaction metadata when content has nothing sensitive", () => {
    const result = access({
      source_uri: "system://tickets/43",
      content: "The customer asked about shipping times.",
      credential_ctx: GRANTED_CTX
    });
    expect(result.kind).toBe("granted");
    if (result.kind === "granted") {
      expect(result.envelope.access_provenance?.redacted_fields).toBeUndefined();
      expect(result.envelope.provenance).toBe("system-authoritative");
    }
  });
});
