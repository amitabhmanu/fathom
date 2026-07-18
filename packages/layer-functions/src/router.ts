export type DriftSignalType =
  | "content-edited"
  | "query-intent-shifted"
  | "source-moved"
  | "competing-source-appeared"
  | "policy-changed"
  | "fact-changed"
  | "task-evolved";

export type ReEntryLayer = "1" | "2" | "3" | "3f" | "4" | "5" | "6";

export interface DriftSignal {
  type: DriftSignalType;
  /** How confident the caller is that this classification is correct. */
  confidence: number;
}

export interface RouteDriftResult {
  /** Whether the signal cleared this layer's confidence bar and should actually be acted on. */
  triggered: boolean;
  re_entry_layer: ReEntryLayer;
  /** Every layer from the entry point down to 1, per the nesting rule — re-entering at
   *  layer N re-runs every gate from N down to 1, never a partial patch. Empty if not triggered. */
  cascade: ReEntryLayer[];
  threshold_applied: number;
}

const RE_ENTRY_MAP: Record<DriftSignalType, ReEntryLayer> = {
  "content-edited": "2",
  "query-intent-shifted": "1",
  "source-moved": "4",
  "competing-source-appeared": "3f",
  "policy-changed": "3",
  "fact-changed": "5",
  "task-evolved": "6"
};

// Nesting order, coarsest (hardest) to finest (easiest) — matches the layers doc's own
// 6 -> 1 ordering. routeDrift() slices from the entry layer to the end of this array.
const CASCADE_ORDER: ReEntryLayer[] = ["6", "5", "4", "3f", "3", "2", "1"];

// A false trigger at layer 1 (re-rank) is cheap; a false trigger at layer 6 (assume the
// goal changed) can derail an entire task. Higher layers require higher confidence before
// acting, per the layers doc's "false-positive cost is asymmetric by layer" design principle.
const LAYER_CONFIDENCE_THRESHOLDS: Record<ReEntryLayer, number> = {
  "1": 0.3,
  "2": 0.4,
  "3": 0.6,
  "3f": 0.6,
  "4": 0.7,
  "5": 0.8,
  "6": 0.9
};

export function defaultThresholdFor(layer: ReEntryLayer): number {
  return LAYER_CONFIDENCE_THRESHOLDS[layer];
}

/**
 * The layer router: classifies a drift signal's re-entry layer and decides, given the
 * signal's confidence, whether it actually clears that layer's bar to act on. Rule-based
 * and deterministic — a lookup table, not a classifier model, per the roadmap's "start
 * rule-based first" guidance.
 *
 * `thresholdOverrides` (Phase 6): lets a caller supply a tuned threshold per layer instead
 * of the hardcoded default — see tuning.ts's adjustThreshold(). Falls back to the default
 * for any layer not present in the override map.
 */
export function routeDrift(signal: DriftSignal, thresholdOverrides?: Partial<Record<ReEntryLayer, number>>): RouteDriftResult {
  const reEntryLayer = RE_ENTRY_MAP[signal.type];
  const threshold = thresholdOverrides?.[reEntryLayer] ?? LAYER_CONFIDENCE_THRESHOLDS[reEntryLayer];
  const triggered = signal.confidence >= threshold;
  const startIndex = CASCADE_ORDER.indexOf(reEntryLayer);
  const cascade = triggered ? CASCADE_ORDER.slice(startIndex) : [];

  return { triggered, re_entry_layer: reEntryLayer, cascade, threshold_applied: threshold };
}
