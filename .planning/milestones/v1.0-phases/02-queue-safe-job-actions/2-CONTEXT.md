# Phase 2: Queue-Safe Job Actions - Context

**Gathered:** 2026-04-14  
**Status:** Ready for planning

<domain>
## Phase Boundary

Implement queue-safe artist expansion job actions so admin-triggered enqueue/retry behavior is idempotent, returns clear per-item outcomes, and always uses existing queue orchestration paths. This phase does not include dashboard UI depth (Phase 3) or worker coexistence hardening (Phase 4).

</domain>

<decisions>
## Implementation Decisions

### Duplicate-policy semantics
- Active-job uniqueness is keyed by **Artist Spotify ID only**.
- New enqueue is blocked when an existing job for the same artist is in **queued** or **running**.
- Repeated submissions return per-item **skipped** with reason code `already_active`.
- Items missing artist Spotify ID are rejected per-item as **failed** with reason code `missing_artist_id`.

### Bulk enqueue response contract
- Mixed-result bulk requests return HTTP **200** with per-item results (not fail-fast).
- Response includes both summary counts and per-item details.
- Per-item results preserve **input order**.
- Standard reason codes for this phase: `queued`, `already_active`, `missing_artist_id`, `retry_queued`.

### Retry behavior
- Manual retry is allowed for **failed** jobs only.
- Retry action re-enters queue **immediately**.
- No hard manual retry limit in Phase 2.
- Retry requests for jobs already queued/running return per-item **skipped** with `already_active`.

### Conflict handling
- Duplicate artist entries inside one bulk payload: first occurrence processed, subsequent duplicates skipped.
- Retry reuses/reactivates the existing failed job record (no new record creation for retry).
- Unknown retry job IDs return per-item **failed** with reason code `job_not_found`.
- No running-job preemption/cancel-and-replace behavior in Phase 2.

### Claude's Discretion
- Exact response payload field names and top-level envelope shape, as long as required reason codes and ordering guarantees are preserved.
- Exact naming of API endpoints under `/api/admin/*` that implement these actions.

</decisions>

<specifics>
## Specific Ideas

- Queue safety should mirror existing atomic-guard behavior already used in playlist matching flows.
- Phase 2 should remain backend/action focused; richer dashboard interaction belongs to Phase 3.

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope and requirement mapping
- `.planning/ROADMAP.md` — Phase 2 goal/success criteria and fixed scope boundary
- `.planning/REQUIREMENTS.md` — `QUEUE-02`, `QUEUE-03`, `QUEUE-04`, `SYNC-01`
- `.planning/PROJECT.md` — queue-only operation and worker-orchestration constraints

### Prior phase decisions to preserve
- `.planning/phases/01-admin-access-control/1-CONTEXT.md` — admin gating and `/admin/*`, `/api/admin/*` protection decisions already locked

### Existing queue/orchestration patterns to reuse
- `lib/redisQueue.js` — current enqueue pattern (`RPUSH`) and resilient fallback behavior
- `lib/metadataQueue.js` — batch enqueue return-shape precedent (`queued/failed` counts)
- `pages/api/import-playlist.js` — atomic guard pattern (`status != matching`) for idempotent background task start
- `pages/api/youtube-match.js` — resume/retry semantics, conflict status handling, and queue-path continuity
- `workers/ytMatchWorker.js` — single-consumer queue processing model and failure status transitions
- `workers/artistCrawler.js` — existing artist expansion source and queue handoff behavior
- `models/Playlist.js` — status lifecycle conventions and retry/cooldown metadata precedent

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `requireAdmin` + `/api/admin/*` guard infrastructure from Phase 1 is in place for Phase 2 action endpoints.
- Redis enqueue helpers already encapsulate `rpush` behavior and service-unavailable fallback paths.
- Existing APIs already use race-safe status transitions through atomic Mongo updates.

### Established Patterns
- Fire-and-forget job orchestration is started by API and completed by workers.
- Idempotency/conflict handling is expressed through guarded status updates and explicit API responses.
- Queue workers process serialized job payloads and update persistent status/error fields.

### Integration Points
- Phase 2 action endpoints should plug into `/api/admin/*` only.
- Enqueue/retry actions should feed the same worker/queue path used by artist expansion flow.
- Status/result semantics defined here must be consumable by Phase 3 dashboard without changing meaning.

</code_context>

<deferred>
## Deferred Ideas

- Queue health cards and advanced operational telemetry (Phase 3/4)
- Retry limits/backoff tuning policy beyond immediate manual retry behavior (future hardening phase)

</deferred>

---

*Phase: 02-queue-safe-job-actions*  
*Context gathered: 2026-04-14*
