export interface RerankItem {
  source_uri: string;
  content: string;
  score: number;
  last_modified?: string;
}

/**
 * Reorders scored candidates: primarily by score, then breaks ties by recency (more
 * recently modified wins). This is the layer-1 solution component for "silent staleness
 * within an otherwise fine source" from docs/fathom-context-engineering-layers.md —
 * recency only matters once relevance is already comparable, so it's a tiebreaker, not
 * an independent ranking factor.
 */
export function rerank<T extends RerankItem>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    const aTime = a.last_modified ? Date.parse(a.last_modified) : 0;
    const bTime = b.last_modified ? Date.parse(b.last_modified) : 0;
    return bTime - aTime;
  });
}
