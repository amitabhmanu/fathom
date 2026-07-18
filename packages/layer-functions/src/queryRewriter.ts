const STOPWORDS = new Set([
  "a", "an", "the", "in", "of", "to", "and", "is", "are", "this", "that",
  "for", "on", "with", "at", "by", "from", "as", "it", "its", "be", "or",
  "was", "were", "which", "not", "how", "what", "where"
]);

/** Splits camelCase/PascalCase boundaries within an already-non-alphanumeric-delimited token. */
function splitIdentifierCasing(token: string): string[] {
  return token
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(" ")
    .filter(Boolean);
}

/**
 * Normalizes a user prompt or tool query into search tokens: splits on non-alphanumeric
 * boundaries and camelCase/snake_case identifier boundaries, lowercases, and strips
 * stopwords. This is what lets a query rewritten from natural language match how source
 * content is actually indexed (file paths, symbol names, doc headings).
 */
export function rewriteQuery(query: string): string[] {
  const roughTokens = query.split(/[^a-zA-Z0-9]+/).filter(Boolean);
  const tokens: string[] = [];
  for (const token of roughTokens) {
    tokens.push(...splitIdentifierCasing(token));
  }
  return tokens.map((t) => t.toLowerCase()).filter((t) => t.length > 0 && !STOPWORDS.has(t));
}
