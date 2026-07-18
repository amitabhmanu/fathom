const VECTOR_DIM = 256;
const NGRAM_SIZE = 3;

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/**
 * Zero-dependency stand-in for a real embedding: a bag-of-character-trigrams hashed into
 * a fixed-size vector. Deliberately naive (no network/API-key dependency for Phase 1,
 * per docs/fathom-roadmap.md) — it captures rough lexical/semantic overlap, not meaning.
 */
export function embedText(text: string): number[] {
  const vector = new Array(VECTOR_DIM).fill(0);
  const normalized = text.toLowerCase().replace(/[^a-z0-9]+/g, " ");
  for (let i = 0; i <= normalized.length - NGRAM_SIZE; i++) {
    const gram = normalized.slice(i, i + NGRAM_SIZE);
    if (gram.trim().length === 0) continue;
    const index = hashString(gram) % VECTOR_DIM;
    vector[index] += 1;
  }
  return vector;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) {
    return 0;
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function scoreEmbedding(query: string, content: string): number {
  return cosineSimilarity(embedText(query), embedText(content));
}
