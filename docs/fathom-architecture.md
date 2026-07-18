# Fathom architecture: a sidecar for Claude Code CLI

Companion to [fathom-context-engineering-layers.md](fathom-context-engineering-layers.md). That doc defines *what* the seven layers are. This doc defines *how* Fathom observes and intervenes in a real Claude Code session to enforce them, without living inside Claude Code's own process.

## Why Claude Code CLI is the right host

The layers doc's core architectural constraint is: **sidecar, not embedded** — Fathom must be agent-agnostic. Claude Code CLI happens to expose exactly the two extension surfaces a sidecar needs, without requiring a fork or wrapper around the agent loop:

1. **Hooks** — shell commands invoked at named lifecycle points, given JSON on stdin, and able to return JSON that blocks, modifies, or injects context. This is the interception mechanism.
2. **MCP servers** — tools the model can call directly. This is the first-class-action mechanism (asking a clarifying question, reporting a gap, requesting an access grant are all *actions*, not side effects of some other tool call).

Fathom uses hooks for *passive* interception (everything that flows through the agentic loop gets gated whether or not the model knows Fathom exists) and MCP for *active* interception (giving the model explicit verbs for layer-6/5/4/3f/3 situations that require asking rather than just gating).

## Two processes, not one

```
┌─────────────────┐         stdin/stdout JSON          ┌──────────────────┐
│  Claude Code CLI │ ───────────────────────────────────▶│   hook shims     │
│  (agent loop)    │◀───────────────────────────────────│  (thin scripts)  │
└─────────────────┘                                      └────────┬─────────┘
        │                                                          │ local IPC
        │ MCP stdio/HTTP                                           │ (unix socket /
        ▼                                                          │  named pipe)
┌─────────────────┐                                      ┌────────▼─────────┐
│  fathom-mcp      │◀─────────── shared state ───────────▶│    fathomd        │
│  (MCP server)    │                                       │  (sidecar daemon) │
└─────────────────┘                                       └──────────────────┘
                                                                     │
                                                              ┌──────▼──────┐
                                                              │ context store│
                                                              │ (envelopes,  │
                                                              │  registry,   │
                                                              │  feedback)   │
                                                              └─────────────┘
```

- **`fathomd`** is a local, long-lived daemon (one per project checkout, or one per machine keyed by project path) holding the actual state: the context object contract store, the source-of-truth registry, the catalog, the feedback store. It's a persistent local server so state survives across Claude Code sessions and across `/clear` / compaction events within a session.
- **Hook shims** are the thin, fast scripts Claude Code invokes. They do no logic themselves — they marshal the hook's JSON input, POST it to `fathomd` over a local socket, and print `fathomd`'s JSON response back to stdout. This keeps hook latency low and keeps all real logic in one testable process.
- **`fathom-mcp`** is an MCP server (can be the same binary as `fathomd` in a different mode, or a thin client to it) exposing the explicit-action tools described below. It reads/writes the same state `fathomd` owns.

Windows note (this repo's dev environment): the local IPC transport should be a named pipe (`\\.\pipe\fathomd`) with a TCP-on-localhost fallback, since Unix domain sockets are not uniformly available. `fathomd` should be startable as a per-user background process, not a Windows service, to avoid requiring elevated install steps.

## Hook mapping

Each row is a real Claude Code hook event ([code.claude.com/docs/en/hooks](https://code.claude.com/docs/en/hooks)) mapped to the Fathom component it drives and the layer(s) it can trigger.

| Hook event | Fathom component invoked | Layer(s) touched | What it does |
|---|---|---|---|
| **SessionStart** | Feedback store + registry loader | all (bootstrap) | Loads prior context envelopes, source-of-truth registry, and recurrence stats for this project. Injects a compact state summary via `additionalContext` (e.g. "3 sources flagged fragmented last session"). Can set `watchPaths` to the sources Fathom already knows matter, so `FileChanged` fires on them. |
| **UserPromptSubmit** | Drift detector (implicit) + layer router | 6, 1 | Checks the new prompt against active context envelopes for contradiction/scope-shift. If the task looks unscoped relative to what's loaded, returns `additionalContext` prompting a clarifying question, or `decision: "block"` with `reason` when the mismatch is severe enough to require re-scoping before proceeding (layer 6 re-entry). |
| **PreToolUse** (matched on `Read`, `Grep`, `Glob`, `WebFetch`, `Bash`, `mcp__*`) | Gate enforcement engine, layer 3 sub-checks | 3, 4 | Before content is fetched, checks whether the target `source_uri` is already known-inaccessible (from an earlier `PostToolUseFailure`/`PermissionDenied` in this project, per `AccessStatusStore`) and, if so, `deny`s (format/policy) or `ask`s (credentials — a human might still resolve it) with a reason, rather than letting the same failure repeat. **Scope note from Phase 3:** `updatedInput`-based redirection toward the registry's authoritative source was considered but deferred — it would require PreToolUse to already know a `data_type` association for the target, which no caller establishes yet. The deny/ask gating shipped is the harder, more valuable half; redirection can follow once that association exists. |
| **PostToolUse** | Context object contract wrapper + `fit()` | 2, 1 | Wraps the raw `tool_output` in the envelope (see [fathom-context-contract.md](fathom-context-contract.md)), tags `origin_layer`/`provenance`/`confidence`, and runs the layer-2 budget check. If content is oversized, uses `updatedToolOutput` to replace it with a hierarchical summary plus a retrieval hook, rather than trusting Claude Code's own truncation. Stores the envelope in `fathomd`'s context store keyed by `source_uri` + content hash. |
| **PostToolUseFailure** | Drift detector (explicit) | 3, 4 | A failed fetch is a first-class inaccessibility/relocation signal, not just an error. Classifies `tool_error` (string match): auth errors → layer 3 (credentials, tagged + `additionalContext`), parse/format errors → layer 3 (format, tagged + `additionalContext`), 404/not-found → layer 4 (relocation) — **deferred fully to Phase 4**, per Phase 3's scope: no tagging or decision response happens yet for this case, only the raw event log. Anything unclassifiable is left untagged rather than guessed at. |
| **PermissionDenied** | Drift detector (explicit) | 3 | Policy-driven denial, distinct from a missing credential. Routes to layer 3's policy sub-check rather than the credential sub-check, tags the source via `AccessStatusStore`, and responds with `hookSpecificOutput.retry: false` (asking again won't help a policy block). |
| **PreCompact** | `fit()` override | 2 | Claude Code's built-in compaction is the naive baseline layer 2 is meant to replace. **Corrected during Phase 2 implementation:** real `PreCompact` decision control is `decision:"block"`/`reason` or `hookSpecificOutput.additionalContext` — there is no field that literally replaces or swaps Claude Code's own compaction output. Fathom injects its stored hierarchical summaries (for whatever content in scope already has one) as `additionalContext` alongside compaction, never a `block` decision, so the retrieval-hook contract's "must stay addressable" requirement survives compaction without Fathom pretending to control what compaction itself does to the transcript. |
| **PostCompact** | Feedback store | 2 | Logs what got compacted and whether Fathom's summaries were used, so recurring under-budget situations for the same source get flagged for a standing hierarchical summary instead of ad hoc recompression every time. |
| **FileChanged** | Drift detector (explicit) | varies | Watched-path change is the TTL/webhook-equivalent explicit drift signal from the layers doc. Content-hash diff decides re-entry: same source edited → layer 2 re-entry; hash matches a *different* known source → layer 3f (new competing copy appeared). |
| **ConfigChange** | Drift detector (explicit) | 3 | Permission/policy config changes route straight to layer 3 re-entry for any envelope whose `access_provenance` depended on the changed config. |
| **Stop / SubagentStop** | Feedback store | all | Logs the turn's context usage (which envelopes were used, which layers were entered, gate outcomes) for recurrence tracking and false-positive-rate monitoring. |
| **Elicitation / ElicitationResult** | Layer 5 elicitation path | 5 | When an MCP server (including `fathom-mcp` itself) requests user input, a resulting answer is captured as a provenance-tagged, write-back-eligible artifact rather than a one-off value. |

Hooks Fathom does **not** need for v1 (noted so scope is explicit, not accidentally missing): `Notification`, `MessageDisplay`, `WorktreeCreate/Remove`, `TeammateIdle`, `CwdChanged`. These may matter later for multi-agent-team scenarios but aren't part of the core gate cascade.

## MCP tool surface (explicit actions)

Hooks alone can gate and inject, but "ask a clarifying question" and "escalate to a human" need to be things the model can *choose* to do mid-reasoning, not just things imposed on it. `fathom-mcp` exposes:

| Tool | Layer | Purpose |
|---|---|---|
| `fathom_report_gap` | 6 | Model reports "I don't know what I don't know here" against a completeness checklist; Fathom converts this into a nameable spec and either answers from the registry or surfaces a clarifying question to the user. |
| `fathom_ask_clarifying_question` | 6, 5 | First-class alternative to guessing. Routed through the user-facing turn rather than silently degrading. |
| `fathom_elicit` | 5 | Explicit request to capture tacit knowledge, with a required provenance tag (`human-confirmed` vs `inferred`) on the response. |
| `fathom_query_source_of_truth` | 3f | Given a data type/topic, returns the registry's authoritative source and its ranking rationale, instead of the model picking among conflicting copies itself. |
| `fathom_request_access` | 3 | Explicit credential/scope escalation request; never auto-grants, always surfaces to the human. |
| `fathom_check_freshness` | drift | Model-initiated freshness check on a specific envelope, for cases where the model itself suspects staleness before any automatic detector fires. |

These map directly onto the layers doc's "solution components" (clarifying question, direct elicitation, source-of-truth registry, credential grant, confidence decay) — the MCP surface is just how those components become reachable from inside the model's own reasoning rather than only from the sidecar's outside-in gating.

## Why this satisfies the nesting rule

The layers doc requires that re-entering at layer N re-runs every gate from N down to 1 — no isolated patching. Because every interception point funnels through the single `fathomd` process and its single context-store schema, the gate enforcement engine's cascade (`discover → reconcile → access → fit → rank`) is one code path regardless of which hook triggered it. A `FileChanged` event that routes to layer 4 still falls through layers 3f, 3, 2, and 1 on its way back to a usable envelope — it doesn't get a shortcut just because the trigger came from a file-watch hook instead of a `PreToolUse` gate.

## Resolved decisions (Phase 0)

- **Daemon lifecycle** — resolved: `fathomd` is a standing background process, not tied to any one Claude Code session. It is lazily spawned by whichever hook shim first can't reach it (`/health` check fails → spawn detached → retry with backoff), and keeps running across `SessionEnd`/`SessionStart`. This is what makes "survives SessionEnd" true by construction and avoids a daemon cold-start on every turn. Implemented in `packages/fathomd/src/endpoint.ts` and `packages/fathomd-client/src/client.ts`.
- **Multi-session state** — resolved: the daemon's named-pipe/TCP endpoint and its SQLite file path are both derived from a hash of the resolved project root (`packages/fathomd/src/endpoint.ts`'s `projectHashFor`). Two Claude Code sessions or worktrees on the same project root share one daemon and one store; a different project root gets a fully separate daemon. SQLite's own locking handles concurrent writes at this scale — no additional coordination was needed.

## Open questions still to resolve

- **Latency budget**: `PreToolUse`/`PostToolUse` fire on every tool call — the round trip to `fathomd` must stay well under human-perceptible latency (target: sub-50ms for cache-hit gate checks). Not yet measured under real load; revisit once Phase 1's rank() adds real work to the `PostToolUse` path.
- **Classifier dependency**: implicit drift detection (contradiction, goal reframing) needs a model call of its own. Decide whether that's a local heuristic first (per the layers doc's "start rule-based" guidance) before reaching for a classifier model, and if so which model/cost tier. Not needed until Phase 5.

## Real hook behavior confirmed during Phase 0

Verified against the live Claude Code hooks reference while building the hook shims:

- The common input fields (`session_id`, `cwd`, `permission_mode`, `hook_event_name`, etc.) are present on every event, including `Stop` — the architecture doc's hook table already assumed this, and it holds.
- A hook shim should route on the payload's own `cwd` field rather than trust its inherited OS process `cwd`, since a spawned subprocess's working directory isn't guaranteed to match Claude Code's project root. `packages/hooks/src/lib/runHook.ts` extracts `cwd` from the payload and passes it through explicitly for this reason.
