/**
 * Best-effort source_uri derivation from a PostToolUse tool_input, shared by the
 * ranking (postToolUseRanking.ts) and fit (postToolUseFit.ts) glue. Kept as one
 * function so both concerns agree on what "the source" of a given tool call is.
 */
export function deriveToolSourceUri(toolName: string, toolInput: Record<string, unknown>): string {
  if (toolName === "Read" && typeof toolInput.file_path === "string") {
    return toolInput.file_path;
  }
  if (typeof toolInput.pattern === "string") {
    return `${toolName.toLowerCase()}:${toolInput.pattern}`;
  }
  if (toolName === "Bash" && typeof toolInput.command === "string") {
    return `bash:${toolInput.command}`;
  }
  return `${toolName.toLowerCase()}:unknown`;
}
