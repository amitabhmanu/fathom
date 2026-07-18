import { z } from "zod";
import { CONTEXT_ENVELOPE_SCHEMA_VERSION } from "./envelope.js";

export const OriginLayerSchema = z.enum(["1", "2", "3", "3f", "4", "5", "6"]);

export const ProvenanceSchema = z.enum([
  "authoritative-human",
  "human-confirmed",
  "inferred",
  "reconciled",
  "redacted",
  "cached",
  "system-authoritative"
]);

export const FreshnessContractSchema = z.object({
  ttl_seconds: z.number().int().nullable().optional(),
  version_hash_watch: z.boolean().nullable().optional(),
  session_only: z.boolean().nullable().optional(),
  half_life_seconds: z.number().int().nullable().optional()
});

export const DiscardRecordEntrySchema = z.object({
  source_uri: z.string(),
  reason: z.string(),
  timestamp: z.string().datetime({ offset: true })
});

export const AccessProvenanceSchema = z.object({
  granted_by: z.string(),
  scope: z.string(),
  redacted_fields: z.array(z.string()).optional(),
  policy_ref: z.string().nullable().optional()
});

export const RankingMetadataSchema = z.object({
  query: z.string(),
  score: z.number(),
  rank: z.number().int(),
  retriever: z.string()
});

export const RetrievalHookSchema = z.object({
  full_source_uri: z.string(),
  resolution: z.enum(["doc", "section", "chunk"]),
  parent_hook: z.string().nullable().optional()
});

export const EnvelopeSchema = z.object({
  schema_version: z.literal(CONTEXT_ENVELOPE_SCHEMA_VERSION),
  envelope_id: z.string().min(1),
  content: z.string(),
  content_hash: z.string().optional(),
  source_uri: z.string().min(1),
  origin_layer: OriginLayerSchema,
  provenance: ProvenanceSchema,
  confidence: z.number().min(0).max(1),
  timestamp: z.string().datetime({ offset: true }),
  freshness_contract: FreshnessContractSchema,
  discard_record: z.array(DiscardRecordEntrySchema).optional(),
  discard_record_cleared_reason: z.string().nullable().optional(),
  access_provenance: AccessProvenanceSchema.optional(),
  access_provenance_cleared_reason: z.string().nullable().optional(),
  ranking_metadata: RankingMetadataSchema.optional(),
  retrieval_hook: RetrievalHookSchema.nullable().optional(),
  supersedes: z.string().nullable().optional()
});

export type EnvelopeParseResult =
  | { ok: true; envelope: z.infer<typeof EnvelopeSchema> }
  | { ok: false; issues: z.ZodIssue[] };

export function parseEnvelope(input: unknown): EnvelopeParseResult {
  const result = EnvelopeSchema.safeParse(input);
  if (result.success) {
    return { ok: true, envelope: result.data };
  }
  return { ok: false, issues: result.error.issues };
}
