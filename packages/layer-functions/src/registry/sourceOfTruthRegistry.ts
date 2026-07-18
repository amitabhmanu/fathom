import type { RegistryConfig } from "./registryConfig.schema.js";

export interface SourceOfTruthRegistry {
  rank(dataType: string, sourceUri: string): number;
  rationale(dataType: string): string | undefined;
}

const UNKNOWN_DATA_TYPE_FALLBACK_RANK = 0;

/**
 * A source-of-truth registry backed by the hand-maintained `.fathom/registry.json` config
 * (see docs/fathom-roadmap.md's Phase 3 scope: starts as a hand-maintained file, not a
 * learned/dynamic system). Matches source_uris against each data_type's uri_prefix rules.
 */
export class ConfigSourceOfTruthRegistry implements SourceOfTruthRegistry {
  constructor(private readonly config: RegistryConfig) {}

  rank(dataType: string, sourceUri: string): number {
    const entry = this.config[dataType];
    if (!entry) {
      return UNKNOWN_DATA_TYPE_FALLBACK_RANK;
    }
    const matchingRule = entry.rules.find((rule) => sourceUri.startsWith(rule.uri_prefix));
    return matchingRule ? matchingRule.priority : UNKNOWN_DATA_TYPE_FALLBACK_RANK;
  }

  rationale(dataType: string): string | undefined {
    return this.config[dataType]?.rationale;
  }
}
