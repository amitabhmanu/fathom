import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerQuerySourceOfTruth } from "./tools/querySourceOfTruth.js";
import { registerRequestAccess } from "./tools/requestAccess.js";
import { registerReportGap } from "./tools/reportGap.js";
import { registerAskClarifyingQuestion } from "./tools/askClarifyingQuestion.js";
import { registerElicit } from "./tools/elicit.js";

const SERVER_NAME = "fathom-mcp";
const SERVER_VERSION = "0.1.0";

/**
 * Phase 3 added fathom_query_source_of_truth and fathom_request_access. Phase 4 adds
 * fathom_report_gap, fathom_ask_clarifying_question, and fathom_elicit. Only
 * fathom_check_freshness (drift detection) remains, arriving once Phase 5 exists.
 */
export function createFathomMcpServer(): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  registerQuerySourceOfTruth(server);
  registerRequestAccess(server);
  registerReportGap(server);
  registerAskClarifyingQuestion(server);
  registerElicit(server);
  return server;
}
