function tokenize(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

/**
 * A rough term-frequency score: how much of `content`, by token share, matches the
 * rewritten query tokens. Normalizing by content length means a short piece of content
 * that's mostly the query term scores highest — this is what makes an exact identifier
 * hit outrank a long document that merely mentions the term once.
 */
export function scoreKeyword(queryTokens: string[], content: string): number {
  const contentTokens = tokenize(content);
  if (queryTokens.length === 0 || contentTokens.length === 0) {
    return 0;
  }
  const counts = new Map<string, number>();
  for (const token of contentTokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  let matched = 0;
  for (const queryToken of queryTokens) {
    matched += counts.get(queryToken) ?? 0;
  }
  return matched / contentTokens.length;
}
