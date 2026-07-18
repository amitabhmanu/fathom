import type { ReEntryLayer } from "./router.js";

export interface TuningBounds {
  min: number;
  max: number;
}

export type TuningOutcome = "false-positive" | "false-negative";

// Safe bounds per layer — deliberately narrow, and never allow crossing into another
// layer's usual range. A tuner that could push layer 1's threshold up to 0.9 (layer 6's
// territory) would defeat the asymmetric-cost design the layers doc calls for.
const DEFAULT_BOUNDS: Record<ReEntryLayer, TuningBounds> = {
  "1": { min: 0.1, max: 0.5 },
  "2": { min: 0.2, max: 0.6 },
  "3": { min: 0.4, max: 0.8 },
  "3f": { min: 0.4, max: 0.8 },
  "4": { min: 0.5, max: 0.9 },
  "5": { min: 0.6, max: 0.95 },
  "6": { min: 0.7, max: 0.98 }
};

const ADJUSTMENT_STEP = 0.02;

export function boundsFor(layer: ReEntryLayer): TuningBounds {
  return DEFAULT_BOUNDS[layer];
}

/**
 * Nudges a layer's confidence threshold based on an observed outcome: a false positive
 * (drift triggered but shouldn't have) raises the bar; a false negative (drift should have
 * triggered but didn't) lowers it. Always clamped to the layer's safe bounds, regardless of
 * how many outcomes are applied in a row — this is what makes it safe to call from a loop
 * without a separate rate limiter.
 */
export function adjustThreshold(currentThreshold: number, layer: ReEntryLayer, outcome: TuningOutcome): number {
  const bounds = boundsFor(layer);
  const delta = outcome === "false-positive" ? ADJUSTMENT_STEP : -ADJUSTMENT_STEP;
  const next = currentThreshold + delta;
  return Math.min(bounds.max, Math.max(bounds.min, next));
}
