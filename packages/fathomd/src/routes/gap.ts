import { scope } from "@fathom/layer-functions";
import type { EnvelopeStore } from "../store/envelopeStore.js";
import type { RecurrenceStore } from "../store/recurrenceStore.js";

export interface GapRouteDeps {
  envelopeStore: EnvelopeStore;
  recurrenceStore: RecurrenceStore;
}

export interface ReportGapInput {
  description: string;
  task_context: string;
  checklist_ref?: string;
}

export interface ReportGapResult {
  question: string;
  documentation_priority: boolean;
}

/**
 * Backs the fathom_report_gap MCP tool. Converts a raw signal into a nameable question via
 * scope(), stores the layer-6 envelope, and tracks recurrence by task_context — a topic
 * that keeps surfacing gaps is itself a documentation-priority signal.
 */
export function handleReportGap(input: ReportGapInput, deps: GapRouteDeps): ReportGapResult {
  const scopeSpec = scope({
    raw_signal: input.description,
    task_context: input.task_context,
    checklist_ref: input.checklist_ref
  });

  deps.envelopeStore.put(scopeSpec.envelope);
  deps.recurrenceStore.recordGap(input.task_context);

  return {
    question: scopeSpec.question,
    documentation_priority: deps.recurrenceStore.isDocumentationPriority(input.task_context)
  };
}
