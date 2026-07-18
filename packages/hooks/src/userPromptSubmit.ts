#!/usr/bin/env node
import { runHook } from "./lib/runHook.js";

// Phase 0 stub: passthrough only. Real drift-detector/layer-router logic per
// docs/fathom-architecture.md's hook table arrives in Phase 1/5.
runHook("UserPromptSubmit").catch((err: unknown) => {
  process.stderr.write(`${(err as Error).message}\n`);
  process.exitCode = 1;
});
