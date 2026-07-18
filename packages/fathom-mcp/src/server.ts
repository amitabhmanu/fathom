import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerQuerySourceOfTruth } from "./tools/querySourceOfTruth.js";
import { registerRequestAccess } from "./tools/requestAccess.js";

const SERVER_NAME = "fathom-mcp";
const SERVER_VERSION = "0.1.0";

/**
 * Phase 3 adds the first two explicit-action tools from docs/fathom-api-spec.md:
 * fathom_query_source_of_truth and fathom_request_access. The rest
 * (fathom_report_gap, fathom_ask_clarifying_question, fathom_elicit,
 * fathom_check_freshness) arrive in later phases as their backing layer functions land.
 */
export function createFathomMcpServer(): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  registerQuerySourceOfTruth(server);
  registerRequestAccess(server);
  return server;
}
