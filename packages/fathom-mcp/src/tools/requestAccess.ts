import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { fathomRequest } from "@fathom/fathomd-client";

/**
 * fathom_request_access: explicit credential/scope escalation request. This tool only ever
 * *checks* fathomd's access_grants store (PUT /access/grant is a separate human/admin-only
 * endpoint this tool never calls) — the mechanical guarantee behind "never auto-grants."
 */
export function registerRequestAccess(server: McpServer): void {
  server.registerTool(
    "fathom_request_access",
    {
      description:
        "Requests access to a source_uri under a given scope. Never grants access itself — " +
        "only checks whether a human has already approved this exact source_uri/scope pair.",
      inputSchema: {
        source_uri: z.string(),
        scope: z.string(),
        reason: z.string()
      }
    },
    async ({ source_uri, scope }: { source_uri: string; scope: string; reason: string }) => {
      const result = (await fathomRequest("POST", "/access/check", { source_uri, scope })) as {
        granted: boolean;
      };
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    }
  );
}
