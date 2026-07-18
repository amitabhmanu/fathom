import { postHook } from "@fathom/fathomd-client";
import { readStdinJson } from "./stdin.js";

/**
 * Every real Claude Code hook event carries a `cwd` field (see the "Common to All
 * Events" shape in code.claude.com/docs/en/hooks) stating the project directory for
 * that invocation. Using it directly is more reliable than trusting this process's
 * inherited OS-level cwd, which isn't guaranteed to match.
 */
function extractCwd(payload: unknown): string | undefined {
  if (payload && typeof payload === "object" && "cwd" in payload) {
    const cwd = (payload as { cwd?: unknown }).cwd;
    return typeof cwd === "string" ? cwd : undefined;
  }
  return undefined;
}

/**
 * The one thing every hook shim does: read stdin JSON, hand it to fathomd,
 * print whatever fathomd decides back to stdout. No logic lives here or in
 * any individual shim script — that's the point (see fathom-architecture.md's
 * "thin shim" requirement).
 */
export async function runHook(eventName: string): Promise<void> {
  const payload = await readStdinJson();
  const projectRoot = extractCwd(payload);
  const response = await postHook(eventName, payload, projectRoot ? { projectRoot } : {});
  process.stdout.write(JSON.stringify(response ?? {}));
}
