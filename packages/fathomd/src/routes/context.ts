import type { EnvelopeStore, PutResult } from "../store/envelopeStore.js";
import type { Envelope } from "@fathom/context-contract";

export interface ContextRouteDeps {
  envelopeStore: EnvelopeStore;
}

export function handleGetContext(sourceUri: string, deps: ContextRouteDeps): Envelope[] {
  return deps.envelopeStore.getBySourceUri(sourceUri);
}

export function handlePutContext(body: unknown, deps: ContextRouteDeps): PutResult {
  return deps.envelopeStore.put(body);
}

export function handleDeleteContext(envelopeId: string, deps: ContextRouteDeps): { deleted: boolean } {
  return { deleted: deps.envelopeStore.delete(envelopeId) };
}
