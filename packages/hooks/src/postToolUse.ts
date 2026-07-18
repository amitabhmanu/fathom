#!/usr/bin/env node
import { runHook } from "./lib/runHook.js";

runHook("PostToolUse").catch((err: unknown) => {
  process.stderr.write(`${(err as Error).message}\n`);
  process.exitCode = 1;
});
