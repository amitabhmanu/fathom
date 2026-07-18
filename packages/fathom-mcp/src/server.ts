import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const SERVER_NAME = "fathom-mcp";
const SERVER_VERSION = "0.1.0";

/**
 * Phase 0 scaffold: the server exists and can be connected to a transport, but
 * exposes zero tools. The explicit-action tools from docs/fathom-api-spec.md
 * (fathom_report_gap, fathom_ask_clarifying_question, fathom_elicit,
 * fathom_query_source_of_truth, fathom_request_access, fathom_check_freshness)
 * get registered starting in Phase 3, as their backing layer functions land.
 */
export function createFathomMcpServer(): McpServer {
  return new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
}
