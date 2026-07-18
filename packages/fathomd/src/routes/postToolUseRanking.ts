import type { RankCandidate } from "@fathom/layer-functions";
import { deriveToolSourceUri } from "./toolSourceUri.js";

const RANKABLE_TOOLS = new Set(["Read", "Grep", "Glob"]);

export function isRankableToolUse(toolName: unknown): toolName is "Read" | "Grep" | "Glob" {
  return typeof toolName === "string" && RANKABLE_TOOLS.has(toolName);
}

export interface ExtractedRankInput {
  query: string;
  candidates: RankCandidate[];
}

function extractQuery(toolName: string, toolInput: Record<string, unknown>): string {
  if (toolName === "Read") {
    return typeof toolInput.file_path === "string" ? toolInput.file_path : "";
  }
  return typeof toolInput.pattern === "string" ? toolInput.pattern : "";
}

/**
 * Best-effort source_uri recognition for one line of Grep/Glob tool_output:
 * - grep -n style: "path/to/file.ts:12:matched text" -> "path/to/file.ts:12"
 * - grep (no line numbers): "path/to/file.ts:matched text" -> "path/to/file.ts"
 * - glob style: "path/to/file.ts" (the whole line is just a bare path) -> unchanged
 * - anything else (no recognizable path) -> a synthetic per-line fallback URI
 */
function extractLineSourceUri(line: string, fallbackPrefix: string, index: number): string {
  const prefixedMatch = line.match(/^([^\s:][^:]*\.[a-zA-Z0-9]+):(\d+)?:?/);
  if (prefixedMatch) {
    return prefixedMatch[2] ? `${prefixedMatch[1]}:${prefixedMatch[2]}` : prefixedMatch[1];
  }
  const barePathMatch = line.match(/^[^\s:]+\.[a-zA-Z0-9]+$/);
  if (barePathMatch) {
    return line;
  }
  return `${fallbackPrefix}#L${index}`;
}

/**
 * Translates a real PostToolUse payload's tool_name/tool_input/tool_output into rank()'s
 * generic {query, candidates} shape. This tool-shape-aware glue deliberately lives in
 * fathomd, not @fathom/layer-functions, which stays agent-agnostic per
 * docs/fathom-architecture.md's sidecar rationale.
 *
 * Read: the whole file content is one candidate (no multi-source choice to rank among).
 * Grep/Glob: each non-empty output line becomes its own candidate, so multiple matches
 * across files get ranked and reranked relative to each other.
 */
export function extractRankInput(
  toolName: "Read" | "Grep" | "Glob",
  toolInput: Record<string, unknown>,
  toolOutput: string
): ExtractedRankInput {
  const query = extractQuery(toolName, toolInput);
  const fallbackPrefix = deriveToolSourceUri(toolName, toolInput);

  if (toolName === "Read") {
    return { query, candidates: [{ source_uri: fallbackPrefix, content: toolOutput }] };
  }

  const lines = toolOutput
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const candidates: RankCandidate[] = lines.map((line, index) => ({
    source_uri: extractLineSourceUri(line, fallbackPrefix, index),
    content: line
  }));

  return { query, candidates };
}
