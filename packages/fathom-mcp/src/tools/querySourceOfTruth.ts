import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { fathomRequest } from "@fathom/fathomd-client";

interface RegistryRule {
  uri_prefix: string;
  priority: number;
}
interface RegistryEntry {
  rules: RegistryRule[];
  rationale: string;
}

/**
 * fathom_query_source_of_truth: given a data_type and topic, returns the registry's
 * authoritative source and its ranking rationale — per fathom-api-spec.md, so the model
 * asks the registry rather than picking among conflicting copies itself.
 */
export function registerQuerySourceOfTruth(server: McpServer): void {
  server.registerTool(
    "fathom_query_source_of_truth",
    {
      description:
        "Given a data type (e.g. 'pricing') and a topic, returns the source-of-truth " +
        "registry's authoritative source and the rationale for why it's authoritative.",
      inputSchema: {
        data_type: z.string(),
        topic: z.string()
      }
    },
    async ({ data_type, topic }: { data_type: string; topic: string }) => {
      let entry: RegistryEntry | null = null;
      try {
        entry = (await fathomRequest("GET", `/registry/${encodeURIComponent(data_type)}`)) as RegistryEntry;
      } catch {
        entry = null;
      }

      if (!entry || !entry.rules || entry.rules.length === 0) {
        const result = {
          source_uri: `unknown://${topic}`,
          rationale: `No registry entry for data_type "${data_type}"; nothing to rank against.`
        };
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      }

      const topRule = [...entry.rules].sort((a, b) => b.priority - a.priority)[0];
      const result = {
        source_uri: `${topRule.uri_prefix}${topic}`,
        rationale: entry.rationale
      };
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    }
  );
}
