# Phase 4: Worker Coexistence Hardening - Context

**Gathered:** 2026-04-15  
**Status:** Ready for planning

<domain>
## Phase Boundary

Validate and harden coexistence so admin-triggered artist expansion activity does not regress existing worker-driven product behavior. This phase is about runtime coexistence guarantees (not new end-user features), focusing on SYNC-02 across active workers and core user flows.

</domain>

<decisions>
## Implementation Decisions

### Coexistence test scope
- Validate coexistence against these active workers explicitly: `metadataWorker`, `artistCrawler`, `chartsWorker`, `ytMatchWorker`, and `artistExpandWorker`.
- Validate core user-facing flows during coexistence:
  - import playlist flow (`/api/import-playlist` + matching progress),
  - playlist/status polling (`/api/playlists`, `/api/playlist/[id]/status`),
  - admin enqueue/retry paths already implemented in earlier phases.
- Coexistence verification must include both "during expansion queue activity" and "after expansion activity" checks.

### Load profile and run mode
- Use realistic sustained queue activity (not synthetic extreme stress) as the default run mode for v1 hardening.
- Use mixed workload overlap: artist expansion jobs queued while yt-match and metadata queues are also active.
- Prefer repeatable operator-run scenarios that can be re-executed during UAT, rather than one-off ad hoc observations.

### Regression signals and pass/fail policy
- Treat the following as blocking regressions for SYNC-02:
  - existing workers stop consuming their own queues,
  - playlist import/matching user flows stall unexpectedly,
  - repeated worker-loop crashes or unbounded error growth during coexistence runs.
- Require explicit evidence that queue isolation still holds:
  - artist expansion remains on `demus:artist-expand:queue`,
  - yt-match remains on `demus:ytmatch:queue`,
  - metadata remains on `demus:metadata:queue`.
- Require observable "no regression" outcome, not just process liveness logs.

### Recovery and operator handling
- If coexistence degradation is observed, the immediate phase response is diagnose-and-fix within Phase 4 scope (no silent acceptance).
- Keep queue-safe semantics from prior phases unchanged while hardening coexistence.
- Do not introduce force-run bypasses or cross-queue consumer shortcuts as a mitigation strategy.

### Claude's Discretion
- Exact instrumentation shape (structured logs, counters, lightweight diagnostics endpoint/test script wiring) as long as coexistence evidence is clear and repeatable.
- Exact scenario sequencing and run durations, as long as the required overlap and pass/fail signals above are covered.
- Exact packaging of verification artifacts (report format, checklist layout) as long as downstream verifier/UAT can use them directly.

</decisions>

<specifics>
## Specific Ideas

- [auto] Coexistence should be proven through a repeatable validation matrix, not informal spot checks.
- [auto] Queue isolation boundaries from Phase 2 are non-negotiable and must remain explicit in evidence.
- [auto] Hardening should prioritize preserving existing user workflows while expansion work is active.
- [auto] Keep this phase operationally focused; do not add new admin product features here.

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Scope and requirement sources
- `.planning/ROADMAP.md` — Phase 4 goal/success criteria and fixed scope boundary
- `.planning/REQUIREMENTS.md` — `SYNC-02` requirement definition and traceability
- `.planning/PROJECT.md` — architecture constraints and queue-orchestration policy
- `.planning/STATE.md` — current project position and accumulated phase decisions

### Prior phase decisions to preserve
- `.planning/phases/02-queue-safe-job-actions/2-CONTEXT.md` — queue isolation/idempotency contracts that coexistence must not break
- `.planning/phases/03-admin-expansion-dashboard/03-CONTEXT.md` — dashboard refresh/operation behavior that must remain reliable under coexistence load
- `.planning/phases/03-admin-expansion-dashboard/03-VERIFICATION.md` — completed Phase 3 behavior baseline

### Worker and queue implementation surfaces
- `workers/artistExpandWorker.js` — artist expansion queue consumer and status transition behavior
- `workers/ytMatchWorker.js` — yt-match queue consumer and playlist progress updates
- `workers/metadataWorker.js` — metadata queue consumer behavior
- `workers/artistCrawler.js` — background catalog expansion path and yt-match enqueue behavior
- `workers/chartsWorker.js` — chart-seeding workload path and yt-match enqueue behavior
- `lib/artistExpandQueue.js` — artist expansion enqueue contract (`demus:artist-expand:queue`)
- `lib/redisQueue.js` — yt-match enqueue contract (`demus:ytmatch:queue`)
- `lib/metadataQueue.js` — metadata enqueue contract (`demus:metadata:queue`)

### Core user-flow integration points to monitor
- `pages/api/import-playlist.js` — import + background matching/metadata orchestration
- `pages/api/playlists.js` — user playlist listing behavior during worker overlap
- `pages/api/playlist/[id]/status.js` — playlist status/progress polling behavior
- `pages/api/admin/enqueue-artists.js` — expansion queue producer used during coexistence runs
- `pages/api/admin/retry-jobs.js` — retry producer behavior during coexistence runs

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- Existing worker scripts already operate as standalone queue consumers with isolated queue keys.
- Existing API endpoints provide realistic workload triggers for both admin expansion and normal user flows.
- Phase 3 admin dashboard provides a ready operator surface to trigger expansion actions and observe job states.

### Established Patterns
- Fire-and-forget APIs enqueue work; workers update persistent state asynchronously.
- Queue isolation is explicit by key and consumer responsibility.
- Coexistence-sensitive user behavior is observed through status/progress endpoints rather than direct worker invocation.

### Integration Points
- Phase 4 should add/extend coexistence validation and hardening around current queue-worker boundaries.
- Validation should tie together admin-triggered expansion workload with simultaneous user-triggered import/matching/metadata flows.
- Any fixes must preserve existing endpoint contracts and queue keys from prior phases.

</code_context>

<deferred>
## Deferred Ideas

- Advanced queue telemetry dashboards (depth/lag visual cards) — future ops enhancement.
- Automated worker autoscaling/priority scheduling policy — future hardening phase.
- Multi-tenant or multi-admin operational controls — out of scope for v1.

</deferred>

---

*Phase: 04-worker-coexistence-hardening*  
*Context gathered: 2026-04-15*
