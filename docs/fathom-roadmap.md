# Fathom build roadmap

Companion to [fathom-context-engineering-layers.md](fathom-context-engineering-layers.md) (the model), [fathom-architecture.md](fathom-architecture.md) (the integration), and [fathom-context-contract.md](fathom-context-contract.md) (the schema). This doc sequences the build.

## Sequencing principle

Build bottom-up through the layer stack (1 → 6), not top-down, even though the layers doc orders difficulty 6 → 1. Reason: every higher layer's gate hands off to the layers below it (nesting rule), so layer 1's `rank()` and the envelope store have to exist and be solid before layer 2's `fit()` has anything correct to compress, and layer 2 has to exist before layer 3's `access()` has somewhere to deposit cleared content. Building 6 → 1 first would mean testing the hardest, least-deterministic layers against a foundation that doesn't exist yet. Drift detection and the full gate-cascade router come last because they require all seven gates to already be independently callable.

Each phase lists: goal, deliverables, exit criteria, dependencies. A phase is "done" only when its exit criteria are met — not when code is merged.

---

## Phase 0 — Foundations

**Goal:** a `fathomd` process exists, hook shims talk to it, nothing intelligent happens yet.

**Deliverables:**
- `fathomd` skeleton (local IPC server — named pipe on Windows per [fathom-architecture.md](fathom-architecture.md)) with a health-check endpoint.
- Context envelope store backed by SQLite, schema per [fathom-context-contract.md](fathom-context-contract.md), with a schema-version guard.
- Hook shims for `SessionStart`, `PreToolUse`, `PostToolUse`, `Stop` wired into `.claude/settings.json`, each a pure passthrough (log the event, return no decision).
- `fathomd` CLI for local inspection (`fathomd inspect <source_uri>`, `fathomd log tail`).

**Exit criteria:**
- A real Claude Code session on this project runs with hooks active and zero observable behavior change, but every tool call is logged as a raw (unwrapped) event in `fathomd`'s store.
- Daemon survives a `SessionEnd` and a fresh `SessionStart` without losing prior state.

**Dependencies:** none.

---

## Phase 1 — Layer 1 (happy path: rank)

**Goal:** `PostToolUse` output gets wrapped in a real envelope with real ranking metadata, and a query rewriter/reranker actually change what content gets surfaced.

**Deliverables:**
- `rank(query, candidates)` implementing hybrid (keyword + embedding) retrieval + reranking, per the layers doc's layer-1 solution components.
- Query rewriter for the common Claude-Code case: normalize a user prompt or tool query against how the target source is actually indexed (file paths, symbol names, doc headings).
- Ranking log store (part of the envelope's `ranking_metadata`), queryable via `fathomd inspect`.
- Envelope writer hooked into `PostToolUse` for at least `Read`, `Grep`, `Glob`.

**Exit criteria:**
- Every `Read`/`Grep`/`Glob` result in a session produces a stored envelope with populated `ranking_metadata`.
- A relevance regression test set (hand-built queries with known-correct top result) passes above an agreed threshold — implemented as a top-1 pass rate ≥ 0.8 over 12 hand-built cases (`packages/layer-functions/test/fixtures/relevance-regression-set.json`).

**Implementation notes (concrete interpretations decided during Phase 1):**
- `rank()`'s relevance cutoff is `0.08`, calibrated against the naive n-gram embedding retriever's noise floor (two unrelated passages still share some character trigrams, so the cutoff must clear that floor or nothing ever gets filtered).
- The hybrid retriever weights keyword matching over the naive embedding fallback (0.75/0.25), so an exact identifier/term hit is not overridden by embedding noise — this matters more for code search than loose semantic similarity.
- `PostToolUse`→`rank()` glue (tool-name-specific candidate extraction from `tool_input`/`tool_response`) lives in `packages/fathomd/src/routes/postToolUseRanking.ts`, not in `@fathom/layer-functions`, to keep the layer functions agent-agnostic per the sidecar rationale in fathom-architecture.md. `Read` treats the whole file as one candidate; `Grep`/`Glob` split output into one candidate per line.
- **Real-world correction found during Phase 6 live-session testing, not at original Phase 1 build time:** this glue (and layer-2's `postToolUseFit.ts`) originally assumed a flat `tool_output: string` field on the PostToolUse payload. Inspecting actual captured `raw_events` from a live session showed no real payload has ever had that field — the real field is `tool_response`, shaped differently per tool (see the corrected table in fathom-architecture.md's PostToolUse row). Every hand-authored fixture shared the same wrong assumption, so 191 passing tests never caught it; layers 1 and 2 silently no-op'd in every real tool call until this was fixed. `packages/fathomd/src/routes/toolResponseContent.ts` centralizes the corrected per-tool extraction, deliberately scoped to tools whose result represents fetched/generated content (`Read`, `Grep` content-mode, `Glob`, `Write`, `Bash`/`PowerShell`, `WebFetch`) rather than "any tool" as originally phrased — control/meta tool results (`Edit`'s diff-only response, `TaskUpdate`, `AskUserQuestion`, MCP tool calls) have no natural single content string and are left alone rather than guessed at.
- The ranking log (`packages/fathomd/src/store/rankingLog.ts`) records only cutoff-surviving results, not the full scored-and-dropped set — `rank()`'s API returns only survivors, so logging anything more would require extending its contract, which Phase 1 didn't need.

**Dependencies:** Phase 0.

---

## Phase 2 — Layer 2 (fit)

**Goal:** oversized content gets compressed with a retrievable pointer back to source, instead of relying on Claude Code's default truncation/compaction.

**Deliverables:**
- `fit(content, budget)` returning pass / summarize / delegate.
- Hierarchical summarizer (doc → section → chunk) populating `retrieval_hook` per the contract schema.
- `PreCompact` hook override: substitute Fathom's hierarchical summary for Claude Code's default compaction when one already exists for the content in scope.
- Sub-agent map-reduce path for content too large to summarize linearly (delegates via the `Agent` tool pattern, returns only the distillate envelope).

**Exit criteria:**
- A deliberately oversized fixture (e.g. a large multi-file read) produces a compressed envelope whose `retrieval_hook` successfully resolves back to full content on demand.
- `PostCompact` log shows Fathom's summary was used at least once in a real oversized session, not just in fixture tests.

**Implementation notes (concrete interpretations decided during Phase 2):**
- `fit()`'s per-tool-result budget defaults to 500 tokens (`packages/fathomd/src/routes/postToolUseFit.ts`); the delegate threshold is 8x budget (4000 tokens), both deliberately small so fixtures can exercise all three paths without needing enormous test content.
- Hierarchical summary tiers (doc/section/chunk) are stored under synthetic source_uris (`{source}#summary`, `{source}#summary-section-N`, `{source}#summary-chunk-N-M`), distinct from the original content's own source_uri — this is what lets the original raw content stay independently retrievable (and hash-verifiable) at its real key while the summary lives alongside it, not on top of it.
- `fit()`'s public contract (per fathom-api-spec.md) returns only the doc tier; section/chunk tiers are built and unit-tested (`hierarchical.test.ts`) but not yet persisted by fathomd — full "drill in on demand" wiring is deferred to whichever later phase actually needs it, rather than built speculatively now.
- `existing_hierarchy` is accepted per the API spec but unused in Phase 2 — reusing a previously-computed hierarchy would require `fit()` to fetch stored envelope content, which pure layer functions deliberately don't do (storage access is fathomd's job).
- Layer-2 fit() applies to *any* tool's `PostToolUse` output (not just the Read/Grep/Glob set ranking uses), since oversized-content handling isn't tool-specific the way ranking's candidate extraction is.
- The `PostCompact` "log shows Fathom's summary was used" exit criterion is implemented via a small `CompactionLog` table bridging `PreCompact` (records which envelope_ids it surfaced) and `PostCompact` (reads that back and logs it) — necessary because `PostCompact`'s real hook input doesn't itself reference what `PreCompact` did.

**Dependencies:** Phase 1 (compression needs ranked candidates to decide what's load-bearing).

---

## Phase 3 — Layer 3 and 3f (access, reconciliation)

**Goal:** inaccessible/fragmented sources get gated explicitly instead of failing opaquely or silently picking one copy.

**Deliverables:**
- `access(source, credential_ctx)`: credential/format/policy sub-checks, redaction layer, `access_provenance` population.
- `PreToolUse` gate wired to deny/ask/rewrite based on known-inaccessible sources.
- Source-of-truth registry (starts as a hand-maintained config file mapping data types → authoritative systems) + `reconcile(candidates, registry)`.
- `discard_record` population and `fathom_query_source_of_truth` MCP tool.

**Exit criteria:**
- A fixture with two conflicting "sources" for the same fact resolves to one envelope with a non-empty `discard_record`, and the MCP tool surfaces the same rationale on request.
- A fixture requiring a missing credential produces a human-facing escalation (via hook `ask` or MCP `fathom_request_access`), not a stack trace or silent skip.

**Implementation notes (concrete interpretations decided during Phase 3):**
- `access()`'s format and policy sub-checks are deliberately simple, deterministic heuristics, not a real OCR/parser pipeline or policy DSL: format usability is a control-character-ratio check; policy blocking is a literal `[LEGAL_HOLD]` marker; redaction targets SSN-shaped patterns only. All three are documented as placeholders in `packages/layer-functions/src/redaction/policyLayer.ts` for a later phase to replace.
- `PreToolUse` gating only covers deny/ask based on previously-known inaccessibility (`AccessStatusStore`, populated by real `PostToolUseFailure`/`PermissionDenied` events) — registry-based `updatedInput` redirection was deferred (see fathom-architecture.md's `PreToolUse` row) since no caller yet establishes a `data_type` association for an arbitrary tool call's target.
- `fathom_request_access` never auto-grants by construction, not just convention: its read path (`POST /access/check`) and the human/admin write path (`PUT /access/grant`) are separate daemon endpoints, and the MCP tool only ever calls the former.
- The source-of-truth registry (`.fathom/registry.json`, committed) uses `uri_prefix` matching rather than exact source_uri lookup, since real candidate URIs vary (e.g. `crm://pricing/plan-a` vs `crm://pricing/plan-b`) — ranking is per-system, not per-exact-URI.

**Dependencies:** Phase 2 (reconciled/access-cleared content still needs to pass through fit/rank before use).

---

## Phase 4 — Layer 4, 5, 6 (discovery, elicitation, unknown context)

**Goal:** the hardest, least-deterministic layers get their minimum viable solution components — likely the least automatable phase, most reliant on the MCP explicit-action surface.

**Deliverables:**
- `discover(query, catalog)`: catalog lookup + agent-driven exploration fallback, routing multi-candidate results to layer 3f.
- `elicit(question, human_available)` + `fathom_elicit` MCP tool, with mandatory provenance tagging and write-back to the envelope store.
- `scope(gap)` + `fathom_report_gap`/`fathom_ask_clarifying_question` MCP tools, backed by a starter completeness checklist (even a short, hand-written one per task type) for legible-failure design.
- Recurrence tracking: repeated layer-5/6 hits on the same topic get flagged in the feedback store as documentation-priority candidates.

**Exit criteria:**
- At least one real session where a genuine knowledge gap gets surfaced as a clarifying question via `fathom_ask_clarifying_question` rather than the model confabulating.
- An elicited answer, once given, is retrievable in a later session as a layer-5 envelope (proves write-back works end to end) — verified with a real process kill + restart integration test, structurally identical to Phase 0's own restart-persistence test.

**Implementation notes (concrete interpretations decided during Phase 4):**
- `fathom_ask_clarifying_question` does **not** use the MCP protocol's server-initiated elicitation capability (`elicitation/create`), even though the SDK supports it — real-world client-side support was judged too uncertain to build the exit criterion on top of. Instead the tool returns the question as its own result text for the model to relay conversationally; the answer comes back as a normal next turn, then gets formalized via `fathom_elicit`. This is documented as a deliberate, revisitable scope decision, not an oversight — see fathom-architecture.md's MCP tool table.
- `elicit()` and `fathom_elicit` both require the answer to already be in hand (`human_answer`) rather than attempting to fetch one interactively, for the same reason: pure functions and simple request/response tools can't carry out an "ask and wait" step themselves.
- `discover()` only implements the catalog-lookup half of layer 4. The layers doc's "agent-driven exploration when the catalog is silent" isn't something a pure function does — `discover()` returning `none-below-threshold` *is* the signal that should prompt the calling model to explore on its own; no separate exploration mechanism was built.
- Recurrence tracking landed narrower than the roadmap's original phrasing ("feedback store"): it's a dedicated `gap_events` table keyed by `task_context`, not a general cross-layer outcome log. A broader feedback store (logging every layer's gate outcomes, per fathom-architecture.md's Feedback store component) remains future work — Phase 4 only needed gap/question recurrence.
- `fathom_report_gap` and `fathom_ask_clarifying_question` share the same underlying `/gap/report` daemon endpoint and recurrence tracking, since both are fundamentally "name a gap and track how often it recurs" — they differ only in framing (checklist-driven vs. direct question) and tool-facing description, not mechanism.

**Dependencies:** Phase 3 (a discovered/elicited item still needs to flow through reconciliation → access → fit → rank).

---

## Phase 5 — Drift detection and the layer router

**Goal:** staleness gets detected and correctly routed to a re-entry layer, per the layers doc's drift-signature table.

**Deliverables:**
- Explicit detectors: `FileChanged`/`ConfigChange` hooks wired to content-hash and policy-change comparisons (cheap, rule-based first, per the layers doc's guidance).
- Confidence decay implementation using each envelope's `freshness_contract`.
- Layer router: rule-based classifier for the deterministic cases in the drift-signature table (source moved, permissions changed, same-source-edited); a model-backed classifier only for the genuinely semantic cases (contradiction detection, goal reframing) — added last, and only if the rule-based router's false-negative rate on those cases proves too high.
- Full gate cascade re-entry: confirm that routing to layer N actually re-runs N down to 1, not a partial patch.

**Exit criteria:**
- Each row of the drift-signature table in the layers doc has at least one passing fixture proving correct re-entry layer selection.
- False-positive rate at layer 1 (cheap re-rank) is measurably higher-tolerance than at layer 6 (task rescope) — i.e. the asymmetric-cost design principle is enforced in the router's confidence thresholds, not just documented.

**Implementation notes (concrete interpretations decided during Phase 5):**
- **Confidence decay was not built.** The roadmap's own deliverable list included "confidence decay implementation using each envelope's `freshness_contract`," but Phase 5 didn't need it to satisfy either exit criterion — nothing yet reads a decayed confidence value to make a decision. `freshness_contract` fields (`ttl_seconds`, `half_life_seconds`, `session_only`, `version_hash_watch`) are populated per origin_layer as designed, but no scheduled or on-read process computes a decayed score from them yet. Flagged here rather than silently dropped; revisit when a real caller needs to compare confidence across time, not just at write time.
- Detection is a genuine two-hop mechanism only for `FileChanged` and `ConfigChange`, which really do lack decision control (confirmed against the live hooks reference, not assumed). `PostToolUseFailure`'s `source-moved` case and `UserPromptSubmit`'s `query-intent-shifted` case are single-hop, since both hooks support `additionalContext` directly — building a two-hop path for those would have been unnecessary complexity.
- `FileChanged`'s real payload shape has no documented "which file changed" field. The detector defensively tries a conventional `file_path` field and no-ops (falls through to just the raw event log) if it's absent, rather than guessing further or crashing — a real deployment may need this adjusted once real payloads are observed.
- `task-evolved` (layer 6) has no rule-based detector — genuinely semantic goal-reframing detection needs a classifier model per this phase's own deliverable list ("added last, and only if... proves too high"), and no rule-based signal for it was found. `routeDrift()` still supports routing to layer 6 correctly (tested directly), so wiring a detector later doesn't require router changes.
- The cascade runner (`runCascadeFrom`) only auto-executes layers 2 and 1 (fit/rank) — layers 3/3f/4/5/6 require external input (credentials, human answers, real discovery/reconciliation) a background handler can't supply, so those are surfaced via `additionalContext` rather than faked. This is tested behaviorally (stored envelope hash/ranking_metadata actually change) rather than via call-count spies on the layer-functions module, since ESM module mocking across workspace-symlinked packages is fragile and behavioral proof is the stronger guarantee anyway — it can't pass on a no-op cascade the way a spy count could.

**Dependencies:** Phases 1–4 (every gate must exist and be independently callable before the router can dispatch to it).

---

## Phase 6 — Feedback store maturity and self-tuning

**Goal:** Fathom gets better at itself over time instead of re-solving the same drift/fragmentation events from scratch each time.

**Deliverables:**
- Recurrence-based promotion: a source that fragments repeatedly gets promoted into the source-of-truth registry permanently rather than reconciled fresh every time.
- Session-level reporting: per-session summary of gate outcomes, drift events, and false-positive/negative flags for human review.
- Tuning loop: thresholds (confidence, relevance, router confidence-to-route) adjustable from observed outcomes rather than hardcoded.

**Exit criteria:**
- At least one registry promotion happens automatically from observed recurrence, without a human manually editing the registry config.
- A month of session logs shows a measurable drop in repeat layer-3f/layer-5 events for the same sources.

**Implementation notes (concrete interpretations decided during Phase 6):**
- Registry auto-promotion is wired through a new `POST /reconcile` endpoint (`packages/fathomd/src/routes/reconcileRoute.ts`) — the first real caller of `reconcile()`, which until now was only ever invoked directly in tests. `RegistryPromotionStore` tracks each source's non-tiebreak reconciliation win count per `data_type`; crossing the threshold (3) auto-writes a rule into `.fathom/registry.json` with `auto_promoted: true` and `promoted_at` set, and records the event in a `registry_promotions` table via `promotionHistory()` — a hand-edited rule (via `PUT /registry/{data_type}`) has neither field, which is the audit trail distinguishing automatic promotion from a manual change, not a separate log format. Idempotent: already-promoted sources don't get duplicate rules on further wins. **First exit criterion met** — proven end-to-end in `packages/fathomd/test/routes/reconcile.route.test.ts` (repeated wins → promotion, ambiguous candidates → no promotion, already-promoted → no duplicate rule).
- Session-level reporting landed as `GET /report/session` + `fathomd report` (CLI) (`packages/fathomd/src/routes/sessionReport.ts`), aggregating ranking, compaction, drift (with a by-signal-type breakdown), access-denial, gap-recurrence, and registry-promotion data into one snapshot. It is **not** scoped to an actual session boundary — no session-id concept is persisted anywhere in this codebase — so it's a recent-activity window (last 1000 events per store) rather than "since SessionStart." Revisit if a later phase needs true per-session scoping.
- Tuning loop: `adjustThreshold()` (Phase 6's first task, `packages/layer-functions/src/tuning.ts`) is a pure function with its own per-layer safe-bounds table, deliberately narrow enough that no layer's threshold can drift into another layer's usual range. `routeDrift()` already accepted a `thresholdOverrides` parameter (added alongside it); Phase 6 completes the loop with a persisted `ThresholdStore` (`packages/fathomd/src/store/thresholdStore.ts`) and a `POST /drift/outcome` endpoint that reads the current threshold, calls `adjustThreshold()`, and persists the result — applied on every one of `routes/hook.ts`'s four `routeDrift()` call sites (`FileChanged`, `ConfigChange`, `PostToolUseFailure`, `UserPromptSubmit`), so a tuning adjustment takes effect daemon-wide and survives a restart. Verified behaviorally, not just via the pure-function bounds tests: `packages/fathomd/test/routes/driftOutcome.route.test.ts` proves a tuned-up layer-4 threshold actually suppresses a `source-moved` signal that would otherwise have fired.
- **The "month of session logs shows a measurable drop" exit criterion is explicitly not automated or fixture-tested** — a fixture asserting a fabricated month of logs would prove nothing about real usage. This requires a genuine manual review procedure instead: periodically (e.g. weekly) capture `fathomd report`'s `drift.by_signal_type` and `registry_promotions` sections, and compare snapshots taken weeks apart for the same recurring sources. A real drop in repeat `fact-changed`/`competing-source-appeared` events against sources that show up in `registry_promotions.recent` would be the actual signal — this needs real accumulated usage over time, not something buildable in this session.

**Dependencies:** Phase 5.

---

## Explicitly out of scope for now

- Multi-agent-team coordination (`TeammateIdle`, cross-agent envelope sharing) — noted as a non-goal in the architecture doc's hook mapping; revisit only after Phase 6.
- A hosted/shared `fathomd` serving multiple users or machines — v1 is single-user, local-first.
- Any UI beyond the `fathomd inspect`/`log` CLI — a dashboard is a plausible Phase 7+ idea, not before.
