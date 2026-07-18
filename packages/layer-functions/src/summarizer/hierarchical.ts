import { randomUUID, createHash } from "node:crypto";
import { CONTEXT_ENVELOPE_SCHEMA_VERSION, type Envelope, type RetrievalHook } from "@fathom/context-contract";

const CHUNK_SIZE_CHARS = 400;
const CHUNKS_PER_SECTION = 3;
const PREVIEW_CHARS = 120;
const LAYER2_HALF_LIFE_SECONDS = 3600;

export interface HierarchyResult {
  doc: Envelope;
  sections: Envelope[];
  chunks: Envelope[];
}

function makeTierEnvelope(params: {
  content: string;
  sourceUri: string;
  resolution: RetrievalHook["resolution"];
  parentHook: string | null;
  fullSourceUri: string;
}): Envelope {
  const now = new Date().toISOString();
  return {
    schema_version: CONTEXT_ENVELOPE_SCHEMA_VERSION,
    envelope_id: randomUUID(),
    content: params.content,
    content_hash: createHash("sha256").update(params.content).digest("hex"),
    source_uri: params.sourceUri,
    origin_layer: "2",
    provenance: "system-authoritative",
    confidence: 1,
    timestamp: now,
    freshness_contract: { half_life_seconds: LAYER2_HALF_LIFE_SECONDS },
    retrieval_hook: {
      full_source_uri: params.fullSourceUri,
      resolution: params.resolution,
      parent_hook: params.parentHook
    }
  };
}

function chunkText(content: string, chunkSizeChars: number): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < content.length; i += chunkSizeChars) {
    chunks.push(content.slice(i, i + chunkSizeChars));
  }
  return chunks.length > 0 ? chunks : [content];
}

function preview(text: string, maxChars: number): string {
  const trimmed = text.trim();
  return trimmed.length <= maxChars ? trimmed : `${trimmed.slice(0, maxChars)}…`;
}

/**
 * Builds a three-tier hierarchical summary (doc -> section -> chunk) of oversized content,
 * per the layers doc's layer-2 "hierarchical summarizer" solution component. Deterministic
 * and model-free by design (Phase 2 stays local-first, per the roadmap): section/doc-tier
 * "summaries" are extractive previews, not generated prose — good enough to keep content
 * addressable across a compaction event, not a substitute for real summarization later.
 *
 * Tier envelopes are stored under distinct synthetic source_uris (`#summary`,
 * `#summary-section-N`) so they never collide with the original content's own source_uri —
 * every tier's retrieval_hook.full_source_uri points back to that original, unmodified key.
 */
export function buildHierarchy(content: string, sourceUri: string): HierarchyResult {
  const rawChunks = chunkText(content, CHUNK_SIZE_CHARS);

  const sectionGroups: string[][] = [];
  for (let i = 0; i < rawChunks.length; i += CHUNKS_PER_SECTION) {
    sectionGroups.push(rawChunks.slice(i, i + CHUNKS_PER_SECTION));
  }

  const docEnvelope = makeTierEnvelope({
    content: preview(
      sectionGroups.map((group) => preview(group.join(" "), PREVIEW_CHARS)).join("\n"),
      PREVIEW_CHARS * 4
    ),
    sourceUri: `${sourceUri}#summary`,
    resolution: "doc",
    parentHook: null,
    fullSourceUri: sourceUri
  });

  const sections: Envelope[] = [];
  const chunks: Envelope[] = [];

  sectionGroups.forEach((group, sectionIndex) => {
    const sectionContent = group.join("");
    const sectionEnvelope = makeTierEnvelope({
      content: preview(sectionContent, PREVIEW_CHARS),
      sourceUri: `${sourceUri}#summary-section-${sectionIndex}`,
      resolution: "section",
      parentHook: docEnvelope.envelope_id,
      fullSourceUri: sourceUri
    });
    sections.push(sectionEnvelope);

    group.forEach((chunkContent, chunkIndexInSection) => {
      const chunkEnvelope = makeTierEnvelope({
        content: chunkContent,
        sourceUri: `${sourceUri}#summary-chunk-${sectionIndex}-${chunkIndexInSection}`,
        resolution: "chunk",
        parentHook: sectionEnvelope.envelope_id,
        fullSourceUri: sourceUri
      });
      chunks.push(chunkEnvelope);
    });
  });

  return { doc: docEnvelope, sections, chunks };
}
