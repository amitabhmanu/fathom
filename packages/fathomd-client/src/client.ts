import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { resolveEndpoint, readEndpointFile, type FathomEndpoint } from "@fathom/fathomd";
import { requestJson } from "./httpRequest.js";

const require = createRequire(import.meta.url);

export interface PostHookOptions {
  projectRoot?: string;
  maxSpawnRetries?: number;
  retryDelayMs?: number;
}

export interface EnsureDaemonDeps {
  checkHealth: (endpoint: FathomEndpoint) => Promise<boolean>;
  spawnDaemon: (endpoint: FathomEndpoint) => void;
  sleep: (ms: number) => Promise<void>;
}

function resolveDaemonCliPath(): string {
  return require.resolve("@fathom/fathomd/dist/cli.js");
}

async function realCheckHealth(endpoint: FathomEndpoint): Promise<boolean> {
  const info = readEndpointFile(endpoint);
  if (!info) return false;
  try {
    const res = (await requestJson(info, "GET", "/health")) as { ok?: boolean } | undefined;
    return res?.ok === true;
  } catch {
    return false;
  }
}

function realSpawnDaemon(endpoint: FathomEndpoint): void {
  const cliPath = resolveDaemonCliPath();
  const child = spawn(process.execPath, [cliPath, "start"], {
    detached: true,
    stdio: "ignore",
    // NODE_NO_WARNINGS: suppresses the node:sqlite ExperimentalWarning that would otherwise
    // print to the daemon's stderr on every start (fathomd's own concern, not the caller's).
    env: { ...process.env, FATHOM_PROJECT_ROOT: endpoint.projectRoot, NODE_NO_WARNINGS: "1" }
  });
  child.unref();
}

function realSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const defaultEnsureDaemonDeps: EnsureDaemonDeps = {
  checkHealth: realCheckHealth,
  spawnDaemon: realSpawnDaemon,
  sleep: realSleep
};

/**
 * Ensures a fathomd daemon is reachable for `endpoint`'s project, lazily spawning
 * one (detached, not tied to this process) if the health check fails, then
 * retrying with backoff. Per docs/fathom-architecture.md's daemon-lifecycle
 * decision: fathomd is a standing background process, not tied to any one
 * Claude Code session, so a hook shim only ever needs to spawn it once.
 */
export async function ensureDaemonRunning(
  endpoint: FathomEndpoint,
  options: PostHookOptions = {},
  deps: EnsureDaemonDeps = defaultEnsureDaemonDeps
): Promise<void> {
  if (await deps.checkHealth(endpoint)) {
    return;
  }

  deps.spawnDaemon(endpoint);

  const maxRetries = options.maxSpawnRetries ?? 10;
  const delayMs = options.retryDelayMs ?? 150;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    await deps.sleep(delayMs);
    if (await deps.checkHealth(endpoint)) {
      return;
    }
  }
  throw new Error(`fathomd did not become healthy after spawn for project ${endpoint.projectRoot}`);
}

export async function postHook(
  eventName: string,
  payload: unknown,
  options: PostHookOptions = {},
  deps: EnsureDaemonDeps = defaultEnsureDaemonDeps
): Promise<unknown> {
  // Precedence matches the CLI's own projectRootFromEnv(): an explicit caller-supplied
  // projectRoot wins, then FATHOM_PROJECT_ROOT (set when a daemon is spawned, and usable
  // by any caller wanting to target that same project without inheriting OS cwd), then
  // process.cwd() as the last resort. Hook shims should prefer passing the hook payload's
  // own `cwd` field as options.projectRoot (see runHook.ts) rather than relying on this
  // fallback, since inherited OS cwd is not guaranteed to match Claude Code's project root.
  const projectRoot = options.projectRoot ?? process.env.FATHOM_PROJECT_ROOT ?? process.cwd();
  const endpoint = resolveEndpoint(projectRoot);
  await ensureDaemonRunning(endpoint, options, deps);
  const info = readEndpointFile(endpoint);
  if (!info) {
    throw new Error("fathomd endpoint file missing immediately after ensureDaemonRunning reported healthy");
  }
  return requestJson(info, "POST", `/hook/${encodeURIComponent(eventName)}`, payload);
}
