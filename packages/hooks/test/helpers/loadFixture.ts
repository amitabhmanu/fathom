import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
// packages/hooks/test/helpers -> repo root -> fixtures/hooks
const fixturesDir = path.resolve(here, "..", "..", "..", "..", "fixtures", "hooks");

export function loadFixture(name: string): unknown {
  const raw = fs.readFileSync(path.join(fixturesDir, name), "utf-8");
  return JSON.parse(raw);
}
