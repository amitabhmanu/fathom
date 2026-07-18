import fs from "node:fs";
import path from "node:path";
import {
  parseRegistryConfig,
  ConfigSourceOfTruthRegistry,
  type RegistryConfig,
  type RegistryEntry,
  type SourceOfTruthRegistry
} from "@fathom/layer-functions";

const REGISTRY_FILENAME = "registry.json";

/**
 * Loads and (via PUT) updates `.fathom/registry.json`, the hand-maintained source-of-truth
 * config. Unlike `.fathom/state/` (gitignored, per-machine daemon state), this file is
 * meant to be committed — see docs/fathom-roadmap.md's Phase 3 scope.
 */
export class RegistryStore {
  private config: RegistryConfig;
  private readonly registryPath: string;

  constructor(projectRoot: string) {
    this.registryPath = path.join(projectRoot, ".fathom", REGISTRY_FILENAME);
    this.config = this.loadFromDisk();
  }

  private loadFromDisk(): RegistryConfig {
    if (!fs.existsSync(this.registryPath)) {
      return {};
    }
    const raw = JSON.parse(fs.readFileSync(this.registryPath, "utf-8"));
    const parsed = parseRegistryConfig(raw);
    if (!parsed.ok) {
      throw new Error(
        `invalid .fathom/registry.json: ${parsed.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`
      );
    }
    return parsed.config;
  }

  getEntry(dataType: string): RegistryEntry | undefined {
    return this.config[dataType];
  }

  setEntry(dataType: string, entry: RegistryEntry): void {
    this.config[dataType] = entry;
    fs.mkdirSync(path.dirname(this.registryPath), { recursive: true });
    fs.writeFileSync(this.registryPath, JSON.stringify(this.config, null, 2));
  }

  toRegistry(): SourceOfTruthRegistry {
    return new ConfigSourceOfTruthRegistry(this.config);
  }
}
