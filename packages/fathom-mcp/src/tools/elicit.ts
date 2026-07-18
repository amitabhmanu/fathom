import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { fathomRequest } from "@fathom/fathomd-client";

/**
 * fathom_elicit: formalizes and writes back tacit knowledge once it's been obtained.
 *
 * Doc-sync note: expects `human_answer` already in hand (from a normal conversation turn
 * after fathom_ask_clarifying_question), since a pure/tool function can't itself carry out
 * an interactive "ask and wait" step — see layer-functions' elicit() and
 * docs/fathom-roadmap.md's Phase 4 notes. Throws a clear tool error if called without one,
 * rather than fabricating a fact.
 */
export function registerElicit(server: McpServer): void {
  server.registerTool(
    "fathom_elicit",
    {
      description:
        "Formalizes and durably writes back an already-obtained answer to a previously " +
        "posed question, tagging it human-confirmed. Call fathom_ask_clarifying_question " +
        "first, relay the question, then call this once you have the user's answer.",
      inputSchema: {
        question: z.string(),
        human_answer: z.string()
      }
    },
    async ({ question, human_answer }: { question: string; human_answer: string }) => {
      const result = (await fathomRequest("POST", "/elicit", { question, human_answer })) as
        | { ok: true; content: string; provenance: string; source_uri: string }
        | { ok: false; reason: string };

      if (!result.ok) {
        throw new Error(`fathom_elicit could not be resolved: ${result.reason}`);
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              content: result.content,
              provenance: result.provenance,
              source_uri: result.source_uri
            })
          }
        ]
      };
    }
  );
}
