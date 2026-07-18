import type { RawEventLog } from "../store/rawEventLog.js";

export interface HookRouteDeps {
  rawEventLog: RawEventLog;
}

/**
 * Phase 0 behavior: every hook event is logged raw and gets back the minimal
 * no-op shape. No layer-function dispatch yet — that starts in later phases,
 * each of which extends this handler per docs/fathom-architecture.md's hook
 * table, keeping all hook-shape<->cascade translation in this one file.
 */
export function handleHook(eventName: string, payload: unknown, deps: HookRouteDeps): Record<string, never> {
  deps.rawEventLog.append(eventName, payload);
  return {};
}
