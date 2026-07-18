# Fathom context object contract

Companion to [fathom-context-engineering-layers.md](fathom-context-engineering-layers.md) (defines why each field exists) and [fathom-architecture.md](fathom-architecture.md) (defines where envelopes get created — `PostToolUse`, `fathom_elicit`, etc.). This doc is the normative schema.

## Purpose

Every piece of context that enters or lives in `fathomd`'s store — regardless of which layer produced it or which hook/tool touched it — is wrapped in one envelope shape. This is what lets the gate enforcement engine, drift detector, and feedback store operate generically instead of needing per-source special cases.

## Envelope schema (v1)

```jsonc
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "fathom://schema/context-envelope/v1",
  "title": "Fathom Context Envelope",
  "type": "object",
  "required": [
    "envelope_id", "content", "source_uri", "origin_layer",
    "provenance", "confidence", "timestamp", "freshness_contract"
  ],
  "properties": {
    "envelope_id": {
      "type": "string",
      "description": "Stable identifier for this envelope instance (uuid). Distinct from content hash so an envelope can be superseded without losing its identity in logs."
    },
    "content": {
      "type": "string",
      "description": "The actual context payload as it will be presented to the model. For layer-2 outputs this is the compressed/summarized representation, not raw source."
    },
    "content_hash": {
      "type": "string",
      "description": "Hash of the raw source content (pre-compression) at fetch time. Used by the drift detector for explicit change detection (FileChanged, hash-mismatch) independent of what compression later did to `content`."
    },
    "source_uri": {
      "type": "string",
      "description": "Canonical locator for where this came from: file path, URL, MCP resource URI, or a synthetic `fathom://elicited/{id}` for layer-5 artifacts with no system of record."
    },
    "origin_layer": {
      "type": "string",
      "enum": ["1", "2", "3", "3f", "4", "5", "6"],
      "description": "Which layer's gate last produced/validated this envelope. Determines default freshness half-life (see Confidence decay below) and which re-entry rules apply on drift."
    },
    "provenance": {
      "type": "string",
      "enum": ["authoritative-human", "human-confirmed", "inferred", "reconciled", "redacted", "cached", "system-authoritative"],
      "description": "How this content came to be trusted. `inferred` and `reconciled` content must never be silently upgraded to `authoritative-human` even after repeated reuse — see Provenance rules."
    },
    "confidence": {
      "type": "number",
      "minimum": 0,
      "maximum": 1,
      "description": "Point-in-time confidence score. Distinct from provenance: a `human-confirmed` answer from 18 months ago may have lower confidence than a `system-authoritative` live fetch from 2 minutes ago."
    },
    "timestamp": {
      "type": "string",
      "format": "date-time",
      "description": "When this envelope was created/last validated (not when the underlying fact originated, if known separately)."
    },
    "freshness_contract": {
      "type": "object",
      "description": "Governs drift-detector TTL behavior. Exactly one of ttl_seconds / version_hash_watch / session_only / manual should be meaningfully set.",
      "properties": {
        "ttl_seconds": { "type": ["integer", "null"] },
        "version_hash_watch": { "type": ["boolean", "null"], "description": "If true, drift detector treats a content_hash mismatch on the watched source_uri as an explicit invalidation regardless of ttl." },
        "session_only": { "type": ["boolean", "null"], "description": "Envelope is void as soon as the originating session ends (e.g. an elicited answer not yet written back)." },
        "half_life_seconds": { "type": ["integer", "null"], "description": "For confidence decay rather than hard expiry — confidence trends toward 0 continuously rather than flipping stale at a cutoff." }
      }
    },
    "discard_record": {
      "type": "array",
      "description": "Populated only for envelopes that passed through layer 3f reconciliation. Required to travel forward with the reconciled envelope for auditability and future drift checks — never dropped by downstream compression.",
      "items": {
        "type": "object",
        "required": ["source_uri", "reason", "timestamp"],
        "properties": {
          "source_uri": { "type": "string" },
          "reason": { "type": "string" },
          "timestamp": { "type": "string", "format": "date-time" }
        }
      }
    },
    "access_provenance": {
      "type": "object",
      "description": "Populated only for envelopes that passed through layer 3. Must never be dropped downstream — it's what prevents later summarization from re-surfacing redacted material.",
      "properties": {
        "granted_by": { "type": "string", "description": "Who/what approved access (human identity, service-account name)." },
        "scope": { "type": "string", "description": "The grant's scope, e.g. 'read-only:ticket-comments'." },
        "redacted_fields": { "type": "array", "items": { "type": "string" }, "description": "Field names/paths stripped before content reached the model." },
        "policy_ref": { "type": ["string", "null"], "description": "Identifier of the policy rule that governed this access decision, for audit trail." }
      }
    },
    "ranking_metadata": {
      "type": "object",
      "description": "Populated only for envelopes that passed through layer 1 ranking. Consumed by drift detection (query-intent-shift re-entry) and by any later compression step.",
      "properties": {
        "query": { "type": "string" },
        "score": { "type": "number" },
        "rank": { "type": "integer" },
        "retriever": { "type": "string", "description": "Which retriever/reranker produced this score, for debuggability." }
      }
    },
    "retrieval_hook": {
      "type": ["object", "null"],
      "description": "Populated only when `content` is a layer-2 compression of something larger. The one non-negotiable carryover for compressed content — without it, compression is a one-way door.",
      "properties": {
        "full_source_uri": { "type": "string" },
        "resolution": { "type": "string", "enum": ["doc", "section", "chunk"], "description": "Which zoom level this summary sits at in the hierarchical summarizer." },
        "parent_hook": { "type": ["string", "null"], "description": "envelope_id of the next-coarser summary level, if any." }
      }
    },
    "supersedes": {
      "type": ["string", "null"],
      "description": "envelope_id of a prior envelope this one replaces, e.g. after a drift-triggered re-fetch. Keeps a chain for the feedback store without requiring deletion of history."
    }
  }
}
```

## Field rules that aren't obvious from the schema alone

- **`content_hash` vs `content`**: these diverge on purpose once layer 2 compression happens. Drift detection always diffs against `content_hash` (the raw source), never against the possibly-summarized `content` — otherwise a compression pass would look identical to a source change.
- **Provenance is a one-way ratchet downward in trust, never upward.** `inferred` content that later gets reused ten times does not become `human-confirmed`; only an actual human confirmation event changes provenance. Reuse count belongs in the feedback store's recurrence tracking, not in this field.
- **`discard_record` and `access_provenance` are append-only and non-droppable.** Any component in the gate cascade or any summarizer that produces a new envelope from an old one (via `supersedes`) must copy these fields forward. This is the mechanical enforcement of the layers doc's "must never be dropped downstream" requirement — treat it as a schema invariant, not a convention: `fathomd` should reject writes that drop a non-null `access_provenance` or non-empty `discard_record` from a `supersedes` chain without an explicit `access_provenance_cleared_reason`.
- **`origin_layer: "3f"` is a string, not a number**, matching the layers doc's own naming (3f sits between 4 and 3 in difficulty but is a distinct gate, not a numeric midpoint).
- **Synthetic `source_uri` for layer 5/6 artifacts**: use `fathom://elicited/{envelope_id}` or `fathom://scoped/{envelope_id}` so every envelope has a resolvable locator even when no external system holds the content. This keeps `source_uri` a required, always-populated field rather than optional.

## Confidence decay by origin_layer (defaults)

Per the layers doc's drift section — starting defaults, tunable per deployment:

| origin_layer | Default freshness_contract | Rationale |
|---|---|---|
| 1 | `half_life_seconds`: short (minutes–hours) | Live-ranked, cheap to refresh; staleness should bias toward re-ranking often. |
| 2 | inherits the wrapped envelope's contract | Compression doesn't change how fresh the underlying fact is. |
| 3 | `ttl_seconds` tied to grant/credential expiry | Freshness here is really access validity, not content validity. |
| 3f | `version_hash_watch: true` + short half-life | Fragmented sources are the likeliest to silently diverge further. |
| 4 | `ttl_seconds`: long (location rarely changes) | But `version_hash_watch` on the catalog entry itself. |
| 5 | `half_life_seconds`: short, unless `provenance: human-confirmed` written back to a durable store | Tacit knowledge ages fastest and has no system nudging it back to fresh. |
| 6 | `session_only: true` | A scoped spec has no existence past the task that produced it. |

## Versioning

This is schema `v1`. Breaking changes (removing a required field, changing a field's meaning) require a new `$id` (`fathom://schema/context-envelope/v2`) and a migration note here; additive optional fields do not require a version bump. `fathomd` should refuse to load envelopes whose schema version it doesn't recognize rather than guessing at a mapping.
