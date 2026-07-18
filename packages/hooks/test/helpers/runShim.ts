import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const here = fileURLToPath(new URL(".", import.meta.url));
const distDir = path.resolve(here, "..", "..", "dist");

export interface ShimResult {
  stdout: string;
  stderr: string;
}

/** Runs a compiled hook shim (packages/hooks/dist/<name>.js) as a real subprocess, feeding it a fixture on stdin. */
export async function runCompiledHookShim(
  shimName: string,
  fixture: unknown,
  env: NodeJS.ProcessEnv
): Promise<ShimResult> {
  const shimPath = path.join(distDir, `${shimName}.js`);
  // NODE_NO_WARNINGS: the shim transitively imports fathomd's node:sqlite usage (via
  // @fathom/fathomd-client -> @fathom/fathomd's barrel export), which would otherwise print
  // an ExperimentalWarning to stderr on every invocation even though this shim never opens a db.
  const promise = execFileAsync(process.execPath, [shimPath], { env: { ...env, NODE_NO_WARNINGS: "1" } });
  const child = (promise as unknown as { child: ChildProcess }).child;
  child.stdin!.end(JSON.stringify(fixture));
  const { stdout, stderr } = await promise;
  return { stdout, stderr };
}
