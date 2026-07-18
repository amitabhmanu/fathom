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
- `PostToolUse`→`rank()` glue (tool-name-specific candidate extraction from `tool_input`/`tool_output`) lives in `packages/fathomd/src/routes/postToolUseRanking.ts`, not in `@fathom/layer-functions`, to keep the layer functions agent-agnostic per the sidecar rationale in fathom-architecture.md. `Read` treats the whole file as one candidate; `Grep`/`Glob` split output into one candidate per line.
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
- An elicited answer, once given, is retrievable in a later session as a layer-5 envelope (proves write-back works end to end).

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

**Dependencies:** Phase 5.

---

## Explicitly out of scope for now

- Multi-agent-team coordination (`TeammateIdle`, cross-agent envelope sharing) — noted as a non-goal in the architecture doc's hook mapping; revisit only after Phase 6.
- A hosted/shared `fathomd` serving multiple users or machines — v1 is single-user, local-first.
- Any UI beyond the `fathomd inspect`/`log` CLI — a dashboard is a plausible Phase 7+ idea, not before.
