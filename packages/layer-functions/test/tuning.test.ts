import { describe, expect, it } from "vitest";
import { adjustThreshold, boundsFor } from "../src/tuning.js";
import { routeDrift, defaultThresholdFor } from "../src/router.js";
import type { ReEntryLayer } from "../src/router.js";

const ALL_LAYERS: ReEntryLayer[] = ["1", "2", "3", "3f", "4", "5", "6"];

describe("adjustThreshold", () => {
  it("raises the threshold on a false positive", () => {
    const next = adjustThreshold(0.3, "1", "false-positive");
    expect(next).toBeGreaterThan(0.3);
  });

  it("lowers the threshold on a false negative", () => {
    const next = adjustThreshold(0.3, "1", "false-negative");
    expect(next).toBeLessThan(0.3);
  });

  it.each(ALL_LAYERS)("never pushes layer %s's threshold outside its safe bounds, however many outcomes are applied", (layer) => {
    let threshold = defaultThresholdFor(layer);
    for (let i = 0; i < 1000; i++) {
      threshold = adjustThreshold(threshold, layer, "false-positive");
    }
    const bounds = boundsFor(layer);
    expect(threshold).toBeLessThanOrEqual(bounds.max);
    expect(threshold).toBeGreaterThanOrEqual(bounds.min);

    for (let i = 0; i < 1000; i++) {
      threshold = adjustThreshold(threshold, layer, "false-negative");
    }
    expect(threshold).toBeLessThanOrEqual(bounds.max);
    expect(threshold).toBeGreaterThanOrEqual(bounds.min);
  });

  it("never lets one layer's tuned threshold cross into an adjacent layer's default range", () => {
    // Layer 1's bounds cap below layer 2's default, and layer 6's bounds floor above
    // layer 5's default — tuning can't accidentally make layer 1 as cautious as layer 6.
    let layer1Threshold = defaultThresholdFor("1");
    for (let i = 0; i < 1000; i++) {
      layer1Threshold = adjustThreshold(layer1Threshold, "1", "false-positive");
    }
    expect(layer1Threshold).toBeLessThan(defaultThresholdFor("6"));
  });
});

describe("routeDrift with threshold overrides", () => {
  it("uses the override instead of the default when provided", () => {
    const withoutOverride = routeDrift({ type: "query-intent-shifted", confidence: 0.35 });
    expect(withoutOverride.triggered).toBe(true); // default layer-1 threshold is 0.3

    const withOverride = routeDrift({ type: "query-intent-shifted", confidence: 0.35 }, { "1": 0.5 });
    expect(withOverride.triggered).toBe(false); // tuned threshold raised past the signal's confidence
    expect(withOverride.threshold_applied).toBe(0.5);
  });

  it("falls back to the default threshold for any layer missing from the override map", () => {
    const result = routeDrift({ type: "task-evolved", confidence: 0.95 }, { "1": 0.5 });
    expect(result.threshold_applied).toBe(defaultThresholdFor("6"));
  });
});
