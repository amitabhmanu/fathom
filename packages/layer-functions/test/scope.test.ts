import { describe, expect, it } from "vitest";
import { scope } from "../src/scope.js";

describe("scope", () => {
  it("builds a nameable question from the raw signal and task context", () => {
    const result = scope({
      raw_signal: "customer-impact numbers are missing",
      task_context: "drafting the incident postmortem"
    });
    expect(result.question).toContain("drafting the incident postmortem");
    expect(result.question).toContain("customer-impact numbers are missing");
    expect(result.requires_human).toBe(true);
  });

  it("includes the checklist_ref when provided", () => {
    const result = scope({
      raw_signal: "seasonality adjustment not mentioned",
      task_context: "building a forecast",
      checklist_ref: "forecasting-checklist#seasonality"
    });
    expect(result.question).toContain("forecasting-checklist#seasonality");
  });

  it("produces a layer-6 envelope with the lightest carryover (session-only, no content beyond the question)", () => {
    const result = scope({ raw_signal: "x", task_context: "y" });
    expect(result.envelope.origin_layer).toBe("6");
    expect(result.envelope.source_uri).toMatch(/^fathom:\/\/scoped\//);
    expect(result.envelope.freshness_contract.session_only).toBe(true);
    expect(result.envelope.content).toBe(result.question);
  });
});
