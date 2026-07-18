import { adjustThreshold, type ReEntryLayer, type TuningOutcome } from "@fathom/layer-functions";
import type { ThresholdStore } from "../store/thresholdStore.js";

export interface DriftOutcomeInput {
  layer: ReEntryLayer;
  outcome: TuningOutcome;
}

export interface DriftOutcomeResult {
  layer: ReEntryLayer;
  previous_threshold: number;
  new_threshold: number;
}

/**
 * Backs POST /drift/outcome — the human/model feedback path that closes the loop on a
 * routeDrift() decision: was it a false positive (threshold rises) or a false negative
 * (threshold falls)? Persists via ThresholdStore so routeDrift()'s next call, anywhere,
 * picks up the tuned value through its thresholdOverrides parameter.
 */
export function handleDriftOutcome(
  input: DriftOutcomeInput,
  deps: { thresholdStore: ThresholdStore }
): DriftOutcomeResult {
  const previous = deps.thresholdStore.get(input.layer);
  const next = adjustThreshold(previous, input.layer, input.outcome);
  deps.thresholdStore.set(input.layer, next);
  return { layer: input.layer, previous_threshold: previous, new_threshold: next };
}
