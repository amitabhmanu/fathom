import { reconcile, type ReconcileCandidate } from "@fathom/layer-functions";
import type { EnvelopeStore } from "../store/envelopeStore.js";
import type { RegistryStore } from "../store/registryStore.js";
import type { RegistryPromotionStore } from "../store/registryPromotionStore.js";

export interface ReconcileRouteDeps {
  envelopeStore: EnvelopeStore;
  registryStore: RegistryStore;
  registryPromotionStore: RegistryPromotionStore;
}

export interface ReconcileRouteInput {
  data_type: string;
  candidates: ReconcileCandidate[];
}

export interface ReconcileRouteResult {
  chosen_source_uri: string;
  confidence: number;
  requires_human_tiebreak: boolean;
  promoted: boolean;
}

const PROMOTED_RULE_PRIORITY_BONUS = 10;

/**
 * Backs a new /reconcile daemon endpoint — the first real trigger point for reconcile(),
 * which until Phase 6 was only ever called directly in tests. Every call that produces a
 * confident winner (not requiring a human tiebreak) counts toward that source's
 * reconciliation win streak; once it recurs past the threshold, promotes the source into
 * the registry permanently, per the feedback store's recurrence-based promotion component.
 */
export function handleReconcile(input: ReconcileRouteInput, deps: ReconcileRouteDeps): ReconcileRouteResult {
  const registry = deps.registryStore.toRegistry();
  const result = reconcile({ data_type: input.data_type, candidates: input.candidates, registry });

  deps.envelopeStore.put(result.chosen);

  let promoted = false;
  if (!result.requires_human_tiebreak) {
    const sourceUri = result.chosen.source_uri;
    deps.registryPromotionStore.recordWin(input.data_type, sourceUri);

    if (
      deps.registryPromotionStore.isPromotionCandidate(input.data_type, sourceUri) &&
      !deps.registryPromotionStore.alreadyPromoted(input.data_type, sourceUri)
    ) {
      const existingEntry = deps.registryStore.getEntry(input.data_type);
      const maxPriority = existingEntry?.rules.reduce((max, rule) => Math.max(max, rule.priority), 0) ?? 0;
      const nextRules = [
        ...(existingEntry?.rules ?? []),
        {
          uri_prefix: sourceUri,
          priority: maxPriority + PROMOTED_RULE_PRIORITY_BONUS,
          auto_promoted: true,
          promoted_at: new Date().toISOString()
        }
      ];
      deps.registryStore.setEntry(input.data_type, {
        rules: nextRules,
        rationale: existingEntry?.rationale ?? `Auto-promoted after repeatedly winning reconciliation for "${input.data_type}".`
      });
      deps.registryPromotionStore.recordPromotion(input.data_type, sourceUri);
      promoted = true;
    }
  }

  return {
    chosen_source_uri: result.chosen.source_uri,
    confidence: result.confidence,
    requires_human_tiebreak: result.requires_human_tiebreak,
    promoted
  };
}
