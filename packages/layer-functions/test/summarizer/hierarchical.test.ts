import { describe, expect, it } from "vitest";
import { buildHierarchy } from "../../src/summarizer/hierarchical.js";

// 10 chunks of 400 chars each (chunk size), grouped 3-per-section -> 4 sections, 1 doc tier.
const MULTI_SECTION_CONTENT = "x".repeat(10 * 400);

describe("buildHierarchy", () => {
  it("produces three distinct tiers: doc, section, chunk", () => {
    const { doc, sections, chunks } = buildHierarchy(MULTI_SECTION_CONTENT, "file:///big.md");
    expect(doc.retrieval_hook?.resolution).toBe("doc");
    expect(sections.length).toBeGreaterThan(1);
    expect(sections.every((s) => s.retrieval_hook?.resolution === "section")).toBe(true);
    expect(chunks.length).toBeGreaterThan(sections.length);
    expect(chunks.every((c) => c.retrieval_hook?.resolution === "chunk")).toBe(true);
  });

  it("every non-top tier's parent_hook points at the correct coarser envelope_id", () => {
    const { doc, sections, chunks } = buildHierarchy(MULTI_SECTION_CONTENT, "file:///big.md");

    for (const section of sections) {
      expect(section.retrieval_hook?.parent_hook).toBe(doc.envelope_id);
    }

    const sectionIdsByEnvelopeId = new Set(sections.map((s) => s.envelope_id));
    for (const chunk of chunks) {
      const parentId = chunk.retrieval_hook?.parent_hook;
      expect(parentId).toBeTruthy();
      expect(sectionIdsByEnvelopeId.has(parentId!)).toBe(true);
    }

    expect(doc.retrieval_hook?.parent_hook).toBeNull();
  });

  it("every tier's retrieval_hook.full_source_uri points back to the original source_uri, not a tier URI", () => {
    const originalUri = "file:///big.md";
    const { doc, sections, chunks } = buildHierarchy(MULTI_SECTION_CONTENT, originalUri);
    expect(doc.retrieval_hook?.full_source_uri).toBe(originalUri);
    for (const section of sections) {
      expect(section.retrieval_hook?.full_source_uri).toBe(originalUri);
    }
    for (const chunk of chunks) {
      expect(chunk.retrieval_hook?.full_source_uri).toBe(originalUri);
    }
  });

  it("stores tiers under source_uris distinct from the original, so they never collide in the envelope store", () => {
    const originalUri = "file:///big.md";
    const { doc, sections, chunks } = buildHierarchy(MULTI_SECTION_CONTENT, originalUri);
    expect(doc.source_uri).not.toBe(originalUri);
    for (const envelope of [doc, ...sections, ...chunks]) {
      expect(envelope.source_uri).not.toBe(originalUri);
    }
  });

  it("falls back to a single doc/section/chunk tier for content smaller than one chunk", () => {
    const { doc, sections, chunks } = buildHierarchy("small content", "file:///small.md");
    expect(sections).toHaveLength(1);
    expect(chunks).toHaveLength(1);
    expect(doc.retrieval_hook?.resolution).toBe("doc");
  });
});
