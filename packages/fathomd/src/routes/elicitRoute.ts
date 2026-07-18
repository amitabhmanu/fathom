import { elicit } from "@fathom/layer-functions";
import type { EnvelopeStore } from "../store/envelopeStore.js";

export interface ElicitRouteDeps {
  envelopeStore: EnvelopeStore;
}

export interface ElicitRouteInput {
  question: string;
  human_answer?: string;
}

export type ElicitRouteResult =
  | { ok: true; content: string; provenance: "human-confirmed" | "inferred"; source_uri: string }
  | { ok: false; reason: string };

/**
 * Backs the fathom_elicit MCP tool. A pure layer function can't itself carry out an
 * interactive "ask a human" step, so this expects the caller to already have the answer
 * (obtained through a normal conversation turn) — see elicit()'s own doc comment. Writes
 * the resulting envelope back to the store so it's retrievable in a later session,
 * converting this layer-5 event into something durable for future askers.
 */
export function handleElicit(input: ElicitRouteInput, deps: ElicitRouteDeps): ElicitRouteResult {
  // An empty/whitespace-only answer means "no answer yet," not a literal empty fact — the
  // MCP tool's schema requires human_answer as a string (it can't omit the field entirely
  // the way this route's own optional type can), so this is where that gets normalized.
  const trimmedAnswer = input.human_answer?.trim();
  const result = elicit({
    question: input.question,
    human_available: true,
    human_answer: trimmedAnswer ? input.human_answer : undefined
  });

  if (result.kind === "unresolved") {
    return { ok: false, reason: result.reason };
  }

  deps.envelopeStore.put(result.envelope);
  const provenance = result.kind === "human-answer" ? "human-confirmed" : "inferred";
  return { ok: true, content: result.content, provenance, source_uri: result.envelope.source_uri };
}
