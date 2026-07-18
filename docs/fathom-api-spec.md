# Fathom API spec

Companion to [fathom-context-engineering-layers.md](fathom-context-engineering-layers.md) (the components these functions implement), [fathom-architecture.md](fathom-architecture.md) (who calls these — hook shims and `fathom-mcp`), and [fathom-context-contract.md](fathom-context-contract.md) (the envelope type used throughout). This doc is the interface layer: function signatures for the per-layer solution components, the `fathomd` local daemon API that hook shims call, and the MCP tool surface exposed to the model.

All types below are TypeScript-flavored for precision; the actual implementation language is not fixed by this spec. `Envelope` refers to the schema in fathom-context-contract.md.

---

## Layer solution-component functions

These are the seven functions the gate enforcement engine cascades through. Each is independently buildable and testable (per the roadmap's phase sequencing) but must agree on these signatures so the cascade can compose them without adapters.

```ts
// Layer 6 — unknown context
function scope(gap: {
  raw_signal: string;          // the confabulation-risk moment, contradiction, or explicit model report
  task_context: string;        // what task this arose in
  checklist_ref?: string;      // completeness checklist item that triggered this, if any
}): ScopeSpec;

type ScopeSpec = {
  question: string;            // the nameable question/spec, ready for a human or for elicit()
  requires_human: boolean;
  envelope: Envelope;           // origin_layer: "6", source_uri: fathom://scoped/{id}
};

// Layer 5 — doesn't exist anywhere
function elicit(input: {
  question: string;
  human_available: boolean;
}): ElicitResult;

type ElicitResult =
  | { kind: "human-answer"; content: string; envelope: Envelope /* provenance: human-confirmed */ }
  | { kind: "inference"; content: string; envelope: Envelope /* provenance: inferred */; basis: string[] /* source_uris used to infer */ }
  | { kind: "unresolved"; reason: string };

// Layer 4 — location unknown
function discover(input: {
  query: string;
  catalog: CatalogEntry[];
}): DiscoverResult;

type CatalogEntry = { system: string; content_types: string[]; confidence: number };
type DiscoverResult = {
  candidates: { source_uri: string; confidence: number }[];
  route: "single-high-confidence" | "multiple" | "none-below-threshold";
};

// Layer 3f — fragmented
function reconcile(input: {
  data_type: string;                // added during Phase 3: the registry can't rank without knowing the data type
  candidates: { source_uri: string; content: string; last_modified?: string }[];
  registry: SourceOfTruthRegistry;
}): ReconcileResult;

type SourceOfTruthRegistry = { rank(data_type: string, source_uri: string): number };
type ReconcileResult = {
  chosen: Envelope;             // origin_layer: "3f", discard_record populated
  confidence: number;
  requires_human_tiebreak: boolean;
};

// Layer 3 — inaccessible
function access(input: {
  source_uri: string;
  content: string;                  // added during Phase 3: format and redaction sub-checks need the actual content
  credential_ctx: CredentialContext;
}): AccessResult;

type CredentialContext = { available_grants: string[]; requesting_scope: string };
type AccessResult =
  | { kind: "granted"; envelope: Envelope /* access_provenance populated */ }
  | { kind: "denied"; reason: "credentials" | "format" | "policy"; escalation_required: boolean };

// Layer 2 — doesn't fit the window
function fit(input: {
  content: string;
  source_uri: string;              // added during Phase 2: needed to build a correct envelope/retrieval_hook
  budget_tokens: number;
  existing_hierarchy?: RetrievalHook[];
}): FitResult;

type FitResult =
  | { kind: "pass"; envelope: Envelope }
  | { kind: "summarize"; envelope: Envelope /* retrieval_hook populated */ }
  | { kind: "delegate"; subagent_task: string; expected_return_shape: string };

// Layer 1 — happy path
function rank(input: {
  query: string;
  candidates: { source_uri: string; content: string; last_modified?: string }[];
}): RankResult;

type RankResult = {
  ranked: Envelope[];            // ranking_metadata populated, sorted best-first
  cutoff_applied: number;        // relevance threshold used
};
```

### Cascade contract

The gate enforcement engine composes these strictly downward from the entry layer. Each function's output `Envelope` is the next function's input candidate — a function must never be called with content that hasn't cleared the layer above it in the cascade (this is the nesting rule from the layers doc, enforced mechanically here rather than left as a convention):

```
scope → elicit → discover → reconcile → access → fit → rank
 (6)      (5)       (4)         (3f)      (3)     (2)   (1)
```

Entering at layer N means calling that layer's function and then every function to its right, in order, before the result is usable.

---

## `fathomd` local daemon API

What hook shims actually call. Transport: named pipe (Windows) / unix socket, JSON request/response, one call per hook invocation.

```ts
// Called by every hook shim first, to log + get a generic decision
POST /hook/{event_name}
Request: <the hook's native JSON input, passed through unmodified>
Response: <the hook's native JSON output shape (decision, hookSpecificOutput, etc.)>

// Envelope store access (used by fathomd internally and by the `fathomd inspect` CLI)
GET /context/{source_uri} → Envelope | Envelope[]   // may be multiple if fragmented history retained
PUT /context                                         // write/supersede an envelope
DELETE /context/{envelope_id}                        // hard delete, audit-logged, not used by normal gate flow

// Drift
POST /drift/check { source_uri | envelope_id } → { drift: boolean; re_entry_layer?: Layer; signal: string }

// Registry / catalog (Phase 3/4 — hand-maintained config initially, per roadmap)
GET  /registry/{data_type} → { authoritative_source: string; rationale: string }
PUT  /registry/{data_type}
GET  /catalog → CatalogEntry[]

// Feedback / recurrence
POST /feedback/event { layer: Layer; source_uri: string; outcome: "resolved" | "escalated" | "false-positive" }
GET  /feedback/recurrence/{source_uri} → { count: number; last_seen: string; promotion_candidate: boolean }

GET /health → { ok: boolean; version: string }
```

Each `/hook/{event_name}` handler internally dispatches to the layer-function cascade above based on the event mapping in [fathom-architecture.md](fathom-architecture.md)'s hook table, then formats the result back into that specific hook's expected output shape (`permissionDecision` for `PreToolUse`, `updatedToolOutput` for `PostToolUse`, etc.) — the hook-shape translation lives entirely in the `/hook/{event_name}` layer so the layer functions above stay hook-agnostic.

---

## `fathom-mcp` tool surface

Exposed to the model as MCP tools, per the explicit-action rationale in fathom-architecture.md. Each wraps one or more daemon calls.

```ts
// Layer 6
fathom_report_gap(input: { description: string; task_context: string }): { question: string; answer_if_known?: string };
fathom_ask_clarifying_question(input: { question: string }): { user_response: string };

// Layer 5
fathom_elicit(input: { question: string }): { content: string; provenance: "human-confirmed" | "inferred" };

// Layer 3f
fathom_query_source_of_truth(input: { data_type: string; topic: string }): { source_uri: string; rationale: string };

// Layer 3
fathom_request_access(input: { source_uri: string; scope: string; reason: string }): { granted: boolean; envelope?: Envelope };

// Drift (model-initiated check, independent of automatic detectors)
fathom_check_freshness(input: { source_uri: string }): { fresh: boolean; confidence: number; last_verified: string };
```

Every one of these tool calls is itself logged to the feedback store (`POST /feedback/event`) — a model reaching for `fathom_ask_clarifying_question` frequently against the same source is exactly the recurrence signal that should promote that source's documentation priority, per the layers doc's layer-6/5 recurrence-tracking components.

---

## Error handling convention

Every layer function returns a discriminated-union result type rather than throwing, because a "failure" at any layer (denied access, no candidates found, reconciliation needs a human) is a normal, expected outcome the cascade must route on — not an exceptional condition. Only genuine infrastructure failures (daemon unreachable, store corruption) should be thrown/exit-coded, and those surface as `PostToolUseFailure`-style signals per the architecture doc, not as silent gate failures.
