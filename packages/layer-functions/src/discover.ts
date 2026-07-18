export interface CatalogEntry {
  system: string;
  content_types: string[];
  confidence: number;
}

export interface DiscoverInput {
  query: string;
  catalog: CatalogEntry[];
}

export interface DiscoverResult {
  candidates: { source_uri: string; confidence: number }[];
  route: "single-high-confidence" | "multiple" | "none-below-threshold";
}

const CONFIDENCE_THRESHOLD = 0.6;

function catalogEntryMatches(entry: CatalogEntry, queryLower: string): boolean {
  if (entry.system.toLowerCase().includes(queryLower)) {
    return true;
  }
  return entry.content_types.some(
    (contentType) =>
      queryLower.includes(contentType.toLowerCase()) || contentType.toLowerCase().includes(queryLower)
  );
}

/**
 * Layer 4 (location unknown): catalog lookup only. The layers doc's other layer-4
 * component, "agent-driven exploration when the catalog is silent," isn't something a pure
 * function does — it's the model itself trying plausible systems when discover() returns
 * "none-below-threshold". That result *is* the signal that triggers exploration, not a
 * separate mechanism this function needs to implement.
 */
export function discover(input: DiscoverInput): DiscoverResult {
  const queryLower = input.query.toLowerCase();
  const matches = input.catalog
    .filter((entry) => catalogEntryMatches(entry, queryLower))
    .map((entry) => ({ source_uri: `${entry.system}://`, confidence: entry.confidence }));

  const aboveThreshold = matches.filter((m) => m.confidence >= CONFIDENCE_THRESHOLD);

  if (aboveThreshold.length === 0) {
    return { candidates: matches, route: "none-below-threshold" };
  }
  if (aboveThreshold.length === 1) {
    return { candidates: aboveThreshold, route: "single-high-confidence" };
  }
  return { candidates: aboveThreshold, route: "multiple" };
}
