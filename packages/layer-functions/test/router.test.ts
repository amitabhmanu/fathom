import { describe, expect, it } from "vitest";
import { routeDrift, type DriftSignalType, type ReEntryLayer } from "../src/router.js";

// One case per row of docs/fathom-context-engineering-layers.md's drift-signature table.
const DRIFT_TABLE: { type: DriftSignalType; expectedLayer: ReEntryLayer }[] = [
  { type: "content-edited", expectedLayer: "2" },
  { type: "query-intent-shifted", expectedLayer: "1" },
  { type: "source-moved", expectedLayer: "4" },
  { type: "competing-source-appeared", expectedLayer: "3f" },
  { type: "policy-changed", expectedLayer: "3" },
  { type: "fact-changed", expectedLayer: "5" },
  { type: "task-evolved", expectedLayer: "6" }
];

describe("routeDrift", () => {
  it.each(DRIFT_TABLE)("routes $type to layer $expectedLayer with high confidence", ({ type, expectedLayer }) => {
    const result = routeDrift({ type, confidence: 0.95 });
    expect(result.re_entry_layer).toBe(expectedLayer);
    expect(result.triggered).toBe(true);
  });

  it("the returned cascade always runs from the entry layer down through 1", () => {
    const result = routeDrift({ type: "competing-source-appeared", confidence: 0.95 });
    expect(result.cascade).toEqual(["3f", "3", "2", "1"]);
  });

  it("a full layer-6 entry cascades through every layer down to 1", () => {
    const result = routeDrift({ type: "task-evolved", confidence: 0.95 });
    expect(result.cascade).toEqual(["6", "5", "4", "3f", "3", "2", "1"]);
  });

  it("returns an empty cascade and triggered:false when confidence doesn't clear the layer's threshold", () => {
    const result = routeDrift({ type: "task-evolved", confidence: 0.5 });
    expect(result.triggered).toBe(false);
    expect(result.cascade).toEqual([]);
  });

  it("layer 1 tolerates more false positives than layer 6 (asymmetric false-positive cost)", () => {
    const layer1 = routeDrift({ type: "query-intent-shifted", confidence: 0 }).threshold_applied;
    const layer6 = routeDrift({ type: "task-evolved", confidence: 0 }).threshold_applied;
    expect(layer1).toBeLessThan(layer6);
  });

  it("a moderate-confidence signal triggers layer 1 but not layer 6", () => {
    const layer1Result = routeDrift({ type: "query-intent-shifted", confidence: 0.5 });
    const layer6Result = routeDrift({ type: "task-evolved", confidence: 0.5 });
    expect(layer1Result.triggered).toBe(true);
    expect(layer6Result.triggered).toBe(false);
  });
});
