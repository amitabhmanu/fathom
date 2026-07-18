import type { RankCandidate } from "@fathom/layer-functions";
import { deriveToolSourceUri } from "./toolSourceUri.js";
import { extractToolResponseContent } from "./toolResponseContent.js";

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
 * Best-effort source_uri recognition for one line of Grep content-mode output:
 * - grep -n style with a filename prefix: "path/to/file.ts:12:matched text" -> "path/to/file.ts:12"
 * - a bare numbered line ("12:matched text" / "12-context text") when tool_input.path already
 *   names a single file — confirmed against a real captured payload that a single-file Grep's
 *   content lines carry no repeated filename prefix at all -> "{singleFilePath}:12"
 * - glob-style bare path (the whole line is just a path) -> unchanged
 * - anything else (no recognizable path) -> a synthetic per-line fallback URI
 */
function extractLineSourceUri(
  line: string,
  fallbackPrefix: string,
  singleFilePath: string | undefined,
  index: number
): string {
  if (singleFilePath) {
    const numberedMatch = line.match(/^(\d+)[:-]/);
    if (numberedMatch) {
      return `${singleFilePath}:${numberedMatch[1]}`;
    }
  }
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
 * Translates a real PostToolUse payload's tool_name/tool_input/tool_response into rank()'s
 * generic {query, candidates} shape. This tool-shape-aware glue deliberately lives in
 * fathomd, not @fathom/layer-functions, which stays agent-agnostic per
 * docs/fathom-architecture.md's sidecar rationale.
 *
 * Read: the whole file content is one candidate (no multi-source choice to rank among).
 * Grep: each non-empty content-mode output line becomes its own candidate (files_with_matches/
 * count modes carry no per-line text, so extractToolResponseContent yields no candidates —
 * nothing to rank without matched text).
 * Glob: each returned filename becomes its own candidate, content equal to the filename itself.
 */
export function extractRankInput(
  toolName: "Read" | "Grep" | "Glob",
  toolInput: Record<string, unknown>,
  toolResponse: unknown
): ExtractedRankInput {
  const query = extractQuery(toolName, toolInput);
  const fallbackPrefix = deriveToolSourceUri(toolName, toolInput);

  if (toolName === "Read") {
    const content = extractToolResponseContent("Read", toolResponse);
    return content === undefined
      ? { query, candidates: [] }
      : { query, candidates: [{ source_uri: fallbackPrefix, content }] };
  }

  if (toolName === "Glob") {
    const response = toolResponse as { filenames?: unknown } | undefined;
    const filenames = Array.isArray(response?.filenames) ? (response!.filenames as unknown[]) : [];
    const candidates: RankCandidate[] = filenames
      .filter((f): f is string => typeof f === "string")
      .map((filename) => ({ source_uri: filename, content: filename }));
    return { query, candidates };
  }

  // Grep
  const content = extractToolResponseContent("Grep", toolResponse);
  if (content === undefined) {
    return { query, candidates: [] };
  }
  const singleFilePath =
    typeof toolInput.path === "string" && /\.[a-zA-Z0-9]+$/.test(toolInput.path) ? toolInput.path : undefined;
  const lines = content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const candidates: RankCandidate[] = lines.map((line, index) => ({
    source_uri: extractLineSourceUri(line, fallbackPrefix, singleFilePath, index),
    content: line
  }));

  return { query, candidates };
}
