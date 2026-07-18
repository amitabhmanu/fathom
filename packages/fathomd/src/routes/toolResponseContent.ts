/**
 * Extracts the single textual "content" a tool's real PostToolUse `tool_response` carries,
 * for tools whose result represents fetched/generated content worth running through
 * layer-1 rank() or layer-2 fit(). Shapes below were confirmed against real captured
 * fathomd raw_events from a live Claude Code session — not the field this codebase
 * originally assumed (`tool_output: string`), which no real hook payload has ever had; every
 * real PostToolUse payload uses `tool_response`, shaped differently per tool:
 *
 * - Read: { type: "text", file: { filePath, content } }
 * - Grep (content mode only — files_with_matches/count carry no per-line text): { mode, content }
 * - Glob: { filenames: string[] } — no single content string, joined for fit() purposes
 * - Write: { type, filePath, content }
 * - Bash/PowerShell: { stdout, stderr }
 * - WebFetch: { result }
 *
 * Tools with no natural single content string (Edit — only a diff and pre-edit snapshot,
 * not the resulting file; TaskUpdate, AskUserQuestion, ToolSearch, MCP tool calls, etc. —
 * control/meta results, not fetched content) return undefined rather than guessing at a shape.
 */
export function extractToolResponseContent(toolName: string, toolResponse: unknown): string | undefined {
  if (typeof toolResponse !== "object" || toolResponse === null) {
    return undefined;
  }
  const response = toolResponse as Record<string, unknown>;

  if (toolName === "Read") {
    const file = response.file as Record<string, unknown> | undefined;
    return response.type === "text" && typeof file?.content === "string" ? file.content : undefined;
  }
  if (toolName === "Grep") {
    return response.mode === "content" && typeof response.content === "string" ? response.content : undefined;
  }
  if (toolName === "Glob") {
    const filenames = response.filenames;
    return Array.isArray(filenames) && filenames.length > 0 && filenames.every((f) => typeof f === "string")
      ? (filenames as string[]).join("\n")
      : undefined;
  }
  if (toolName === "Write") {
    return typeof response.content === "string" ? response.content : undefined;
  }
  if (toolName === "Bash" || toolName === "PowerShell") {
    return typeof response.stdout === "string" ? response.stdout : undefined;
  }
  if (toolName === "WebFetch") {
    return typeof response.result === "string" ? response.result : undefined;
  }
  return undefined;
}
