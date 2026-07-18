import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { fathomRequest } from "@fathom/fathomd-client";

/**
 * fathom_ask_clarifying_question: the first-class alternative to guessing.
 *
 * Doc-sync note: fathom-api-spec.md originally specified this tool as synchronously
 * returning `{ user_response: string }`, implying the tool call itself blocks on a real
 * answer. That would require the MCP protocol's server-initiated elicitation capability
 * (`elicitation/create`), which exists in the SDK but has uncertain support in real MCP
 * clients today. Phase 4 takes the simpler, more robust path: this tool poses the
 * question (returned as tool-result text, which the calling model relays to the user in
 * its own next turn) and logs it for recurrence tracking — the actual answer arrives as
 * a normal conversational turn, then gets formalized via fathom_elicit.
 */
export function registerAskClarifyingQuestion(server: McpServer): void {
  server.registerTool(
    "fathom_ask_clarifying_question",
    {
      description:
        "Poses a clarifying question rather than silently guessing. The question is " +
        "returned for you to relay to the user directly in your next response — this " +
        "tool does not block waiting for their answer.",
      inputSchema: {
        question: z.string()
      }
    },
    async ({ question }: { question: string }) => {
      await fathomRequest("POST", "/gap/report", {
        description: question,
        task_context: "clarifying-question"
      });
      const result = { posed_question: question };
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    }
  );
}
