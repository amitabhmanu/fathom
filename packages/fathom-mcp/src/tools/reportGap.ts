import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { fathomRequest } from "@fathom/fathomd-client";

/**
 * fathom_report_gap: converts "I don't know what I don't know here" into a nameable
 * question via layer-functions' scope(), and tracks recurrence by task_context so a
 * topic that keeps surfacing gaps gets flagged as a documentation priority.
 *
 * Doc-sync note: fathom-api-spec.md's original return shape was
 * `{ question: string; answer_if_known?: string }`. Phase 4 has no auto-answer capability
 * yet (`answer_if_known` is always omitted), and adds `documentation_priority` — an
 * additive field, not a breaking change to the tool's contract.
 */
export function registerReportGap(server: McpServer): void {
  server.registerTool(
    "fathom_report_gap",
    {
      description:
        "Reports a knowledge gap against a task: converts a confabulation-risk moment " +
        "into a nameable question rather than guessing. Tracks recurrence so a topic that " +
        "keeps surfacing gaps gets flagged as a documentation priority.",
      inputSchema: {
        description: z.string(),
        task_context: z.string(),
        checklist_ref: z.string().optional()
      }
    },
    async ({
      description,
      task_context,
      checklist_ref
    }: {
      description: string;
      task_context: string;
      checklist_ref?: string;
    }) => {
      const result = await fathomRequest("POST", "/gap/report", { description, task_context, checklist_ref });
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    }
  );
}
