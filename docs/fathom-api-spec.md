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
  human_answer?: string;                                // added during Phase 4: a pure function can't
                                                          // itself carry out an interactive "ask" step —
                                                          // the caller supplies the answer once it has one
  inference?: { content: string; basis: string[] };      // added during Phase 4: same reasoning, for the
                                                          // inference branch
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

### Layer router (Phase 5 addition)

Not one of the original seven cascade functions — `routeDrift()` is the "layer router" component from the layers doc's drift section, added when Phase 5 actually built drift detection. Deliberately rule-based (a lookup table, not a classifier model), per the layers doc's own "start rule-based first" guidance:

```ts
type DriftSignalType =
  | "content-edited" | "query-intent-shifted" | "source-moved" | "competing-source-appeared"
  | "policy-changed" | "fact-changed" | "task-evolved";
type ReEntryLayer = "1" | "2" | "3" | "3f" | "4" | "5" | "6";

function routeDrift(
  signal: { type: DriftSignalType; confidence: number },
  thresholdOverrides?: Partial<Record<ReEntryLayer, number>>   // Phase 6 addition — see tuning below
): {
  triggered: boolean;
  re_entry_layer: ReEntryLayer;
  cascade: ReEntryLayer[];        // entry layer down through 1, per the nesting rule
  threshold_applied: number;      // per-layer confidence bar; layer 1's is lowest, layer 6's highest
};
```

The daemon-side cascade runner (`runCascadeFrom()` in `packages/fathomd/src/routes/driftCascade.ts`, not itself a layer-functions export) executes the `cascade` array: layers 2 and 1 get real autonomous reprocessing (`fit()`/`rank()` on freshly-fetched content); layers 3/3f/4/5/6 are surfaced to the model rather than auto-executed, since they inherently need a credential grant, human input, or a real discovery/reconciliation decision a background handler can't supply on its own.

### Threshold tuning (Phase 6 addition)

`routeDrift()`'s per-layer confidence thresholds no longer have to be the router's hardcoded defaults. `adjustThreshold()` (`packages/layer-functions/src/tuning.ts`) nudges a layer's threshold up (false positive) or down (false negative), clamped to a safe per-layer bounds table that never lets one layer's threshold drift into another layer's usual range:

```ts
type TuningOutcome = "false-positive" | "false-negative";
function adjustThreshold(currentThreshold: number, layer: ReEntryLayer, outcome: TuningOutcome): number;
function boundsFor(layer: ReEntryLayer): { min: number; max: number };
```

`fathomd`'s `ThresholdStore` (`packages/fathomd/src/store/thresholdStore.ts`) persists the result per layer and feeds it back into every `routeDrift()` call site in `routes/hook.ts` as `thresholdOverrides`, so a tuning adjustment survives a daemon restart and applies uniformly across all four drift detectors (`FileChanged`, `ConfigChange`, `PostToolUseFailure`, `UserPromptSubmit`).

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

// Drift (Phase 5)
// The originally-sketched model-initiated POST /drift/check was never built — Phase 5's
// detectors are all event-driven (FileChanged, ConfigChange, PostToolUseFailure,
// UserPromptSubmit, /elicit), not a poll-style endpoint a caller queries on demand.
// fathom_check_freshness (below) would be the natural caller for something like this if a
// later phase builds it. Drift events themselves aren't exposed over HTTP at all — they're
// resolved internally between hop 1 (a detector recording one) and hop 2 (PreToolUse
// finding and acting on it), per fathom-architecture.md's FileChanged/ConfigChange rows.

// Registry (Phase 3 — hand-maintained config initially, per roadmap)
// Phase 6 adds two optional fields to each rule (auto_promoted?: boolean, promoted_at?:
// string) written only by POST /reconcile's promotion path, never by a hand-edit through
// this PUT endpoint — the audit trail distinguishing an automatic promotion from a manual
// registry change is "does this rule have those fields," not a separate log.
GET  /registry/{data_type} → RegistryEntry (404 if none configured)
PUT  /registry/{data_type}  body: RegistryEntry → { ok: boolean; reason?: string }
// GET /catalog was speculative and never built: Phase 4's discover() takes a CatalogEntry[]
// supplied directly by the caller rather than fathomd persisting one — nothing yet needs a
// daemon-side catalog store. Revisit only if a real caller needs one.

// Access grants (Phase 3)
POST /access/check body: { source_uri, scope } → { granted: boolean }
PUT  /access/grant  body: { source_uri, scope, approved_by } → { ok: true }  // human/admin-only path;
                                                                             // fathom_request_access
                                                                             // only ever calls /access/check

// Gap reporting / elicitation (Phase 4 — narrower than the originally-sketched generic
// /feedback/event+/feedback/recurrence pair above: recurrence is tracked specifically for
// reported gaps, keyed by task_context, not a general outcome log across all seven layers.
// A broader feedback store remains open for whichever phase actually needs cross-layer
// outcome logging.)
POST /gap/report body: { description, task_context, checklist_ref? } → { question: string; documentation_priority: boolean }
POST /elicit      body: { question, human_answer? } →
  { ok: true; content: string; provenance: "human-confirmed" | "inferred"; source_uri: string } | { ok: false; reason: string }

// Reconciliation + registry auto-promotion (Phase 6)
// The first real trigger point for reconcile() — Phase 3 only ever called it directly in
// tests. Every non-tiebreak win counts toward that source's reconciliation win streak
// (RegistryPromotionStore); once a source recurs past the threshold (3), it's promoted
// permanently into .fathom/registry.json with auto_promoted: true and promoted_at set —
// distinguishing an automatic promotion from a hand-edited registry rule, which has neither
// field. Idempotent: a source already promoted doesn't get a duplicate rule on further wins.
POST /reconcile body: { data_type: string; candidates: { source_uri: string; content: string; last_modified?: string }[] } →
  { chosen_source_uri: string; confidence: number; requires_human_tiebreak: boolean; promoted: boolean }

// Session reporting (Phase 6)
// Aggregates the feedback-store data every prior phase has been logging (ranking,
// compaction, drift, access denials, gaps, registry promotions) into one snapshot, for
// human review. Not scoped to actual session boundaries — no session-id concept is
// persisted anywhere in this system — this is a recent-activity window (last 1000 events
// per store), the same shape whether queried mid-session or after the daemon's been running
// for a while.
GET /report/session → SessionReport   // see packages/fathomd/src/routes/sessionReport.ts

// Threshold tuning (Phase 6)
// Closes the loop on a routeDrift() decision: was it a false positive (raise the layer's
// threshold) or a false negative (lower it)? Persisted via ThresholdStore, applied on every
// subsequent routeDrift() call for that layer via its thresholdOverrides parameter.
POST /drift/outcome body: { layer: ReEntryLayer; outcome: "false-positive" | "false-negative" } →
  { layer: ReEntryLayer; previous_threshold: number; new_threshold: number }

GET /health → { ok: boolean; version: string }
```

`fathomd report` (CLI) prints the same `SessionReport` JSON as `GET /report/session`, for local inspection without a running HTTP client.

Each `/hook/{event_name}` handler internally dispatches to the layer-function cascade above based on the event mapping in [fathom-architecture.md](fathom-architecture.md)'s hook table, then formats the result back into that specific hook's expected output shape (`permissionDecision` for `PreToolUse`, `updatedToolOutput` for `PostToolUse`, etc.) — the hook-shape translation lives entirely in the `/hook/{event_name}` layer so the layer functions above stay hook-agnostic.

---

## `fathom-mcp` tool surface

Exposed to the model as MCP tools, per the explicit-action rationale in fathom-architecture.md. Each wraps one or more daemon calls.

```ts
// Layer 6
fathom_report_gap(input: { description: string; task_context: string; checklist_ref?: string }):
  { question: string; answer_if_known?: string; documentation_priority: boolean };  // documentation_priority added Phase 4
fathom_ask_clarifying_question(input: { question: string }): { posed_question: string };
  // Phase 4 deviation from the original { user_response: string } shape: true synchronous
  // elicitation would require the MCP protocol's server-initiated elicitation capability
  // (elicitation/create), whose real-world client support is unconfirmed. This tool instead
  // poses the question as tool-result text for the calling model to relay in its own next
  // turn; the answer arrives as a normal conversational turn, then gets formalized via
  // fathom_elicit below. See fathom-architecture.md's MCP tool table for the full rationale.

// Layer 5
fathom_elicit(input: { question: string; human_answer: string }):
  { content: string; provenance: "human-confirmed" | "inferred"; source_uri: string };
  // Phase 4 adds the required human_answer input (a pure/tool function can't itself carry
  // out the interactive "ask and wait" step — see elicit()'s own signature above) and
  // source_uri in the output, so a caller can resolve the same envelope again later
  // (GET /context/{source_uri}) without needing to already know its generated envelope_id.

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
