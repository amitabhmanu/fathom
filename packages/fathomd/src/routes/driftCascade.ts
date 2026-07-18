import { fit, rank, wrapContentEnvelope, type ReEntryLayer } from "@fathom/layer-functions";
import type { EnvelopeStore } from "../store/envelopeStore.js";
import type { RankingLog } from "../store/rankingLog.js";

const DEFAULT_BUDGET_TOKENS = 500;

export interface CascadeRunResult {
  /** Layers that got real, autonomous reprocessing (fit + rank — the only layers a
   *  background drift handler can execute without external input). */
  layers_executed: ReEntryLayer[];
  /** Layers that require external action (credentials, human input, discovery, a real
   *  reconciliation decision) that a drift handler can't perform on its own — surfaced to
   *  the model instead of faked. */
  layers_surfaced: ReEntryLayer[];
  stored_envelope_ids: string[];
}

const AUTO_EXECUTABLE: ReadonlySet<ReEntryLayer> = new Set(["2", "1"]);

/**
 * Runs the gate cascade from `reEntryLayer` down to 1 against freshly-fetched content.
 * Per the nesting rule, every layer from the entry point down to 1 is considered — but
 * only layers 2 (fit) and 1 (rank) can actually be re-executed autonomously here; layers
 * 3/3f/4/5/6 inherently need a credential grant, a human answer, or a real discovery/
 * reconciliation step that a background handler can't supply, so those are reported as
 * "surfaced" rather than silently skipped or faked.
 */
export function runCascadeFrom(
  cascade: ReEntryLayer[],
  sourceUri: string,
  freshContent: string,
  deps: { envelopeStore: EnvelopeStore; rankingLog: RankingLog }
): CascadeRunResult {
  const layersExecuted: ReEntryLayer[] = [];
  const layersSurfaced: ReEntryLayer[] = [];
  const storedEnvelopeIds: string[] = [];
  let currentContent = freshContent;

  for (const layer of cascade) {
    if (!AUTO_EXECUTABLE.has(layer)) {
      layersSurfaced.push(layer);
      continue;
    }

    if (layer === "2") {
      const fitResult = fit({ content: currentContent, source_uri: sourceUri, budget_tokens: DEFAULT_BUDGET_TOKENS });
      layersExecuted.push("2");
      if (fitResult.kind === "summarize") {
        const rawEnvelope = wrapContentEnvelope(currentContent, sourceUri);
        deps.envelopeStore.put(rawEnvelope);
        deps.envelopeStore.put(fitResult.envelope);
        storedEnvelopeIds.push(rawEnvelope.envelope_id, fitResult.envelope.envelope_id);
        currentContent = fitResult.envelope.content;
      } else if (fitResult.kind === "pass") {
        deps.envelopeStore.put(fitResult.envelope);
        storedEnvelopeIds.push(fitResult.envelope.envelope_id);
      }
      // "delegate": an oversized re-fetch still needs the same sub-agent delegation a
      // first-time fetch would — intentionally not auto-run here either.
    }

    if (layer === "1") {
      const lastQuery = deps.rankingLog.forSourceUri(sourceUri, 1)[0]?.query ?? sourceUri;
      const { ranked } = rank({ query: lastQuery, candidates: [{ source_uri: sourceUri, content: currentContent }] });
      layersExecuted.push("1");
      for (const envelope of ranked) {
        deps.envelopeStore.put(envelope);
        storedEnvelopeIds.push(envelope.envelope_id);
      }
    }
  }

  return { layers_executed: layersExecuted, layers_surfaced: layersSurfaced, stored_envelope_ids: storedEnvelopeIds };
}
