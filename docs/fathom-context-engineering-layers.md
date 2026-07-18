# Fathom: a layered model of context engineering, drift detection, and gate enforcement

## Overview

In agentic systems, it's the harness's responsibility to provide the model with the right context — this is context engineering. Context engineering isn't one problem; it's a chain of qualitatively different states a piece of context can be in, ordered from hardest to easiest. Each state has its own gate (a test that must pass to move to the next state) and its own carryover (the specific artifact that survives the transition).

**Key structural insight — nesting, not stacking:** these layers are not independent problems to solve in parallel. They form a strictly nested dependency chain. Resolving a higher-numbered layer doesn't eliminate the layers below it — it hands you off to them. Solving layer 6 produces a layer 4-or-5 problem. Solving layer 5 produces a layer 4 problem. And so on, down to layer 1. You can enter the chain partway (wherever your current state of ignorance/obstruction sits), but you cannot skip a rung below your entry point.

**Second structural insight — context drift:** over time, an agent may need different or additional context, and the state of context can fall back to any layer. Drift is not itself a layer — it's a failure mode of time acting on any layer's output. It requires (1) a detector that notices staleness, explicit or implicit, and (2) a router that classifies *what kind* of change occurred, to determine which layer to re-enter. Because of the nesting rule, re-entering at layer N means every gate from N down to 1 must re-run.

---

## The seven layers

Ordered hardest → easiest:

1. **Layer 6 — Unknown context.** We don't even know what the context is.
2. **Layer 5 — Doesn't exist anywhere.** We know what it is, but no record of it exists in the organization.
3. **Layer 4 — Location unknown.** It exists, but we don't know where.
4. **Layer 3f — Fragmented.** It exists in multiple places, possibly conflicting.
5. **Layer 3 — Inaccessible.** We know where it is, but can't reach it (credentials, format, or policy).
6. **Layer 2 — Doesn't fit the window.** It's accessible, but too large to fit in context.
7. **Layer 1 — Happy path.** It's known, accessible, and fits — the challenge is pure relevance/ranking.

---

## Layer 6 — Unknown context

**Description:** No one — human or agent — has yet named what context is missing. This is a *calibration* problem, not retrieval: the system has to notice the shape of its own ignorance before it can look for anything. The default LLM failure mode here is confabulation, not "I notice a gap."

**Enterprise examples:**
- An agent asked to "draft the incident postmortem" with no idea it's missing customer-impact numbers, because no one told it those existed to ask for.
- A new analyst (human or agent) building a forecast who doesn't know "seasonality adjustment" is a standard input this org always applies.

| Challenge | Solution approach |
|---|---|
| Confabulation instead of noticing a gap | Structured completeness checks — rubrics/checklists surfacing "you'd expect an X here" |
| Silent confident wrong answers | Design tasks so missing context produces a legible failure (error/contradiction), not a smooth guess |
| No habit of asking when uncertain | Treat "ask a clarifying question" as a first-class action, not a fallback |
| Gaps only visible in hindsight | Post-hoc review of failures to identify what context was actually missing |
| Org-specific expectations aren't obvious to a new agent | Onboarding checklists / task templates encoding "context an expert would always check" |

**Solution components:**
- **Completeness checklist** — a rubric of what an expert would expect for this task type, used to actively check for absence.
- **Clarifying question (first-class action)** — asking is a legitimate output, not something to avoid.
- **Legible failure design** — tasks structured so missing context produces a visible error/contradiction, not a confidently wrong answer.
- **Post-hoc review** — traces failures back to what context was actually missing.
- **Checklist update** — findings feed back into the checklist so the same blind spot doesn't recur.

**Gate:**
- *Condition:* has the need been converted into a nameable question or spec (via clarifying question, checklist miss, or surfaced contradiction)?
- *Carries over:* just the stated spec of what's missing — no content, no location. The lightest carryover of any layer.

---

## Layer 5 — Doesn't exist anywhere

**Description:** The context is well-defined, but no record of it exists — it's tacit knowledge in someone's head, or genuinely hasn't been figured out. This is knowledge elicitation/generation, not retrieval.

**Enterprise examples:**
- "Why did we choose vendor X over Y three years ago" — decided in a meeting, never written down.
- "What's the workaround for this edge case" — an engineer knows it instinctively but it's undocumented.

| Challenge | Solution approach |
|---|---|
| Knowledge is tacit, held by one person | Direct elicitation — prompt the human for the specific answer |
| No human available right now | Best-effort inference from adjacent evidence, clearly flagged as inference |
| Elicited knowledge disappears again after use | Write-back — capture the answer as a durable artifact for next time |
| Inference gets treated as fact later | Provenance tagging — mark inferred vs. human-confirmed permanently |
| Repeated elicitation for the same gap | Detect recurring layer-5 hits and prioritize them for documentation |

**Solution components:**
- **Direct elicitation** — ask the human the specific missing question.
- **Best-effort inference** — used only when no human is reachable, always flagged as inference, never presented as fact.
- **Provenance-tagged artifact** — the answer, tagged human-confirmed vs. inferred.
- **Write-back to durable store** — converts this layer-5 event into a layer-1 or layer-4 event for future askers.
- **Recurrence tracking** — repeated gaps signal a documentation priority.

**Gate:**
- *Condition:* was the tacit knowledge actually captured — human answered directly, or agent produced a clearly flagged inference?
- *Carries over:* the newly created artifact + its provenance tag (authoritative-human vs. inferred). No location yet — that's layer 4's job.

---

## Layer 4 — Location unknown

**Description:** The context is known to exist somewhere, but no one knows which system holds it. A discovery/indexing problem — searching for *sources*, not content.

**Enterprise examples:**
- A new agent asked about enterprise refund policy with no idea whether that lives in Confluence, a Zendesk macro, a legal doc, or Slack.
- An agent asked for "the latest architecture diagram," with no registry saying whether that's in Notion, a GitHub wiki, or a Miro board.

| Challenge | Solution approach |
|---|---|
| No catalog of what systems exist or hold what | Data catalog / semantic layer mapping systems to content types |
| Search returns low-confidence or no candidates | Agent-driven exploration — try plausible systems, follow references found along the way |
| Tool/source discovery itself is fragmented | Registry pattern (same structural problem as MCP tool discovery) |
| Exhaustive crawling is slow and expensive | Confidence threshold — stop searching and ask a human once candidates are weak |
| Multiple plausible locations found | Hand off to fragmentation (layer 3f) rather than guessing one |

**Solution components:**
- **Catalog lookup** — maps known systems to content types, checked before exploratory search.
- **Single candidate (high confidence)** — passed straight to layer 3.
- **Agent-driven exploration** — tries plausible systems and follows references when the catalog is silent.
- **Multiple-candidate routing** — routes to layer 3f rather than guessing.
- **Human ask (implicit fallback)** — exploration that stalls should escalate rather than crawl indefinitely.

**Gate:**
- *Condition:* did search (catalog or exploration) return one or more candidate locations above a confidence threshold?
- *Carries over:* candidate location(s) + confidence scores. One strong candidate → layer 3. Multiple → layer 3f, carrying the confidence spread too.

---

## Layer 3f — Fragmented

**Description:** Context exists and has been located — but not in one place. Multiple copies exist, possibly disagreeing. The problem is *reconciliation*: which copy is authoritative.

**Enterprise examples:**
- A pricing question where the wiki, the CRM catalog, and a Slack thread all give different numbers.
- An org-chart query where HRIS, the internal directory, and a stale onboarding doc list different managers for the same employee.

| Challenge | Solution approach |
|---|---|
| No agreed source of truth across systems | Source-of-truth registry — explicit ranking of systems by authority per data type |
| Conflicting copies with no timestamp signal | Recency-weighting — prefer the most recently modified/verified copy |
| Ambiguous ownership | Ownership metadata attached at the system level, not the document level |
| Silent picking of one copy hides the disagreement | Discard record — log which copies were rejected and why |
| Some conflicts genuinely can't be resolved automatically | Human tie-break escalation when reconciliation confidence is low |

**Solution components:**
- **Candidate copies** — the same fact as it exists across each system, gathered rather than picked from prematurely.
- **Source-of-truth registry** — a standing ranking of which system is authoritative for which data type.
- **Recency weighting** — used where the registry doesn't settle it outright.
- **Reconciled source + discard record** — the chosen answer, paired with a log of rejected copies and why.
- **Human tie-break** — a first-class escalation path, not a hidden fallback.

**Gate:**
- *Condition:* does a rule (registry match, recency, or human decision) collapse the candidate set to exactly one source with adequate confidence?
- *Carries over:* the single reconciled source + the discard record (rejected copies and reasons). The discard record must travel forward for future drift checks and auditability.

---

## Layer 3 — Inaccessible

**Description:** Context exists and its location is known, but it can't yet be used. This bundles three sub-conditions that must all clear together: **credentials** (auth/permission), **format** (usable form), and **policy** (allowed to be shown given sensitivity).

**Enterprise examples:**
- An agent needing data from a legacy on-prem system requiring an unprovisioned service-account grant.
- A support ticket containing a customer's SSN and payment details — fetchable, but must be redacted before the model ever sees it.

| Challenge | Solution approach |
|---|---|
| No credential/grant exists yet | OAuth flow or service-account provisioning, requested just-in-time |
| Access denied by policy, not missing credentials | Human-in-the-loop escalation — request an explicit grant, don't route around it |
| Content in unusable format (scanned PDF, proprietary binary) | Format transformation pipeline (OCR, schema mapping, document parsers) |
| Sensitive fields present (PII, legal hold) | Redaction/policy layer applied before content reaches the model |
| Access is flaky (rate limits, intermittent downtime) | Retry with backoff + cache last-known-good with a freshness flag |

**Solution components:**
- **Credential grant** — OAuth or service-account provisioning, requested just-in-time.
- **Format transform** — OCR, parsers, schema mapping to make content model-usable.
- **Redaction / policy layer** — strips sensitive fields; policy denials trigger human escalation rather than a workaround.
- **Resolved content + access-provenance record** — final usable content, tagged with who approved it, under what scope, and what was redacted.

**Gate:**
- *Condition:* all three sub-checks clear together — credentials granted, format usable, policy-cleared.
- *Carries over:* the raw usable content + its access-provenance record. This record must never be dropped downstream, since it's what prevents later compression/summarization from accidentally re-surfacing redacted material.

---

## Layer 2 — Doesn't fit the window

**Description:** Context is known, accessible, and relevant — but the full relevant set exceeds the window. A selection/compression problem, not an access problem.

**Enterprise examples:**
- A legal-review agent given an entire contract repository when only a handful of clauses matter.
- A codebase agent fixing a bug where the relevant call chain spans dozens of files.

| Challenge | Solution approach |
|---|---|
| Naive truncation drops load-bearing content | Relevance-ranked selection within a fixed token budget, not first-N or last-N |
| One-shot summarization loses needed detail | Hierarchical summaries at multiple resolutions (doc → section → chunk) |
| Pre-loading everything wastes budget on unused content | Just-in-time retrieval — fetch on demand as sub-questions emerge |
| Very large single tasks (whole-repo refactor, full-book analysis) | Sub-agent map-reduce — delegate chunks, return only distillate |
| Compression becomes a one-way door | Retrieval hooks — compressed summary keeps a pointer back to full source |

**Solution components:**
- **Budget selector** — decides which of three downstream paths a piece of context takes.
- **Just-in-time fetch** — retrieved only when a sub-question actually requires it.
- **Hierarchical summarizer** — multiple zoom levels for drilling in on demand.
- **Sub-agent map-reduce** — for content too large/interlinked to summarize linearly.
- **Context assembler with retrieval hook** — final packed context, every summary carrying a pointer back to full source.

**Gate:**
- *Condition:* does the compressed/selected representation fit within budget without dropping anything load-bearing?
- *Carries over:* the compressed representation + the retrieval hook for every summarized piece — the one non-negotiable carryover, since without it compression is irreversible.

---

## Layer 1 — Happy path

**Description:** Context exists, is known, and is accessible — the challenge is purely relevance: of everything reachable, surface the right slice for this query, every turn.

**Enterprise examples:**
- A support agent finding the right KB article out of thousands, given a customer's specific phrasing.
- A sales-assist agent surfacing the right CRM fields without dumping the whole record into every prompt.

| Challenge | Solution approach |
|---|---|
| Query-context mismatch (user's words ≠ source's words) | Query rewriting / expansion before retrieval |
| Relevant ≠ ranked-first (embedding similarity misses intent) | Hybrid search (keyword + semantic) + reranker model |
| Over-fetching "safe" but irrelevant context | Relevance threshold + top-k tuned per source, not global |
| Silent staleness within an otherwise fine source | Recency-weighting in the ranking score, not just similarity |
| No visibility into why something ranked highly | Log ranking scores/features for debuggability |

**Solution components:**
- **Query rewriter** — normalizes user phrasing to match how the source is indexed.
- **Hybrid retriever** — combines keyword and embedding search.
- **Reranker** — reorders candidates by intent and recency.
- **Context assembler** — packs selected chunks into the prompt.
- **Ranking log store** — records what was retrieved, scored, and dropped.

**Gate:**
- *Condition:* does the ranked, assembled context match the query's intent above a relevance threshold — re-checked every turn, not once per session.
- *Carries over:* the selected context slice + its ranking metadata (score, source, timestamp), used by drift detection and any future compression step.

---

## Context drift

Over time, an agent may need different or additional context, and the state of any piece of context can fall back to any layer. Drift requires two mechanisms:

**1. Detection**
- **Explicit:** TTL expiry, source version-hash mismatch, change webhook firing.
- **Implicit:** the agent's output starts contradicting new input, a user correction fires, or a downstream task fails traceably to bad context.
- **Confidence decay by provenance type:** a layer-5 artifact (elicited, no source) should have a much shorter trust half-life than a layer-1 artifact pulled live from an authoritative system.

**2. Routing — classifying the type of change to determine re-entry layer**

| What changed | Re-entry layer |
|---|---|
| Same source, content edited | 2 (refit/recompress) |
| Same content, query intent shifted | 1 (rerank only — cheapest) |
| Source moved/renamed | 4 (rediscover location) |
| A new competing source appeared | 3f (fragmentation — reconcile) |
| Permissions/redaction policy changed | 3 (access gate) |
| The real-world fact itself changed | 5 (re-elicit — old artifact is void) |
| The task/need itself evolved | 6 (rescope — the question changed, not the answer) |

Because of the nesting rule, re-entering at layer N means every gate from N down to 1 must re-run — you can't selectively patch layer 2 while trusting a stale layer-1 ranking built on top of it.

---

## Fathom: an agentic harness for drift detection and gate enforcement

**Core framing:** this is structurally the same problem as cache coherency in distributed systems. The "cache" is the agent's active context; drift signals are invalidation messages. The difference: instead of one invalidate-and-refetch action, invalidation must route to one of seven different repair procedures depending on what changed.

### Architecture: sidecar, not embedded

Fathom must be agent-agnostic, so it sits alongside any agent, intercepting context in and out, rather than living inside any one agent's reasoning loop.

**Components:**

1. **Context object contract** — the substrate everything depends on. Every piece of context, regardless of which layer produced it or which agent consumes it, is wrapped in a standard envelope:
   ```
   { content, source_uri, origin_layer, provenance (auth/inferred/reconciled...),
     confidence, timestamp, freshness_contract, discard_record? }
   ```
   This is just the provenance metadata each gate already emits, standardized into one schema.

2. **Drift detector** — explicit signals (TTL, hash mismatch, webhooks) and implicit signals (contradiction, user correction, downstream task failure). Freshness contracts decay at different rates depending on `origin_layer`.

3. **Layer router** — a classifier over what changed, mapping the signal to a re-entry layer using the drift-signature table above. Can start rule-based (hash diffs, HTTP status, auth error codes are cheap deterministic signals) and only reach for a classifier model for harder semantic cases (contradiction detection, goal reframing).

4. **Gate enforcement engine** — cascades from the entry layer down to layer 1, calling each layer's solution components (as pluggable, independently-buildable services: `discover()`, `reconcile()`, `access()`, `fit()`, `rank()`, `elicit()`, `scope()`), each layer's output feeding the next as carryover. Never patches a single layer in isolation — the nesting rule requires the full cascade.

5. **Feedback store** — logs every drift event with its entry layer and outcome. Recurring drift at the same layer for the same source is itself a signal (e.g. a source that fragments constantly should get promoted permanently into the source-of-truth registry rather than reconciled fresh every time).

### Key design considerations

- **False-positive cost is asymmetric by layer.** A false trigger at layer 1 (re-rank) is cheap; a false trigger at layer 6 (assume the goal changed) can derail an entire task. The router should require higher confidence to route to expensive/disruptive layers.
- **The harness must be able to say "no drift, proceed."** It's a gate itself — over-triggering undermines the agent's usefulness.
- **Sidecar architecture is required, not optional**, specifically because "any agent" is the goal — an agent-specific implementation couples the harness to one agent's internal state representation, defeating reusability.

---

*Name: Fathom — chosen for its double meaning (to understand deeply / to measure depth), reflecting that different drift events require diving to different depths in the layer chain before context is re-aligned.*
