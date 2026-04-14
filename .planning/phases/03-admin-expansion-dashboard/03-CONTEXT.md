# Phase 3: Admin Expansion Dashboard - Context

**Gathered:** 2026-04-14  
**Status:** Ready for planning

<domain>
## Phase Boundary

Build an admin-only dashboard at `/admin` where the operator can monitor artist expansion jobs (`queued`, `running`, `done`, `failed`), filter/search quickly, select multiple artists, and trigger queue-safe bulk enqueue actions while keeping visible status aligned with real worker outcomes.

</domain>

<decisions>
## Implementation Decisions

### Dashboard structure and information density
- Use a single-page admin dashboard with two sections:
  - **Bulk Queue Controls** (selection + action controls)
  - **Jobs Table** (status visibility and history)
- Use a dense table-style jobs view (not cards) to maximize scanability for operators.
- Jobs table columns should include: `Status`, `Artist`, `Artist Spotify ID`, `Last Updated`, `Error` (for failed), and `Actions`.
- Default ordering is most recently updated first (`updatedAt` descending).

### Filter and search behavior
- Provide status filters for: `all`, `queued`, `running`, `done`, `failed` (default: `all`).
- Provide a search input that matches both artist name and artist Spotify ID (case-insensitive contains).
- Filters and search apply to the jobs view and should be combinable (status + text query together).
- Empty-state messaging must be explicit for both:
  - no jobs yet
  - no jobs match current filters

### Multi-select and bulk queue behavior
- Selection is checkbox-based with:
  - per-row checkbox
  - "select all visible" for currently filtered rows
- Bulk action should queue selected artists through existing `POST /api/admin/enqueue-artists` only (no direct worker trigger).
- Dashboard bulk actions must preserve Phase 2 result semantics by showing per-item outcomes (`queued` / `skipped` / `failed`) and reason codes from the API response.
- Retry for failed jobs stays available and continues using `POST /api/admin/retry-jobs`.

### Status trust and refresh model
- Dashboard state is server-truth driven from `ArtistJob` records (no client-only synthetic status).
- Refresh strategy:
  - immediate refresh after enqueue/retry actions
  - periodic polling while page is open
- Failed rows must visibly show failure reason (`error`) and recency (`updatedAt`), and retry transitions must be observable (`failed` → `queued` → downstream worker states).

### Claude's Discretion
- Exact component split (single page component vs extracted dashboard subcomponents), as long as behavior above is preserved.
- Exact polling cadence and pagination/limit defaults, as long as status freshness remains operationally reliable.
- Exact visual styling details (spacing, typography, badge visuals) within existing admin styling patterns.

</decisions>

<specifics>
## Specific Ideas

- Keep `/admin` as the operator surface (do not create a separate admin route for this phase unless needed for maintainability).
- Keep action semantics queue-safe and consistent with Phase 2 (no force-run or bypass path).
- Prefer an operations-first UI tone: clear status, concise error visibility, low-friction bulk actions.
- Auto mode used for this discuss step; decisions above reflect recommended defaults for Phase 3.

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope and locked requirements
- `.planning/ROADMAP.md` — Phase 3 goal, dependency, and success criteria
- `.planning/REQUIREMENTS.md` — `VIS-01`, `VIS-02`, `VIS-03`, `QUEUE-01`, `SYNC-03`
- `.planning/PROJECT.md` — active constraints (single admin, queue-safe operations)

### Prior phase decisions that must carry forward
- `.planning/phases/01-admin-access-control/1-CONTEXT.md` — admin-only access model and guarded `/admin` + `/api/admin/*`
- `.planning/phases/02-queue-safe-job-actions/2-CONTEXT.md` — queue/retry reason-code contracts and idempotency behavior

### Existing implementation surfaces to extend (not replace)
- `pages/admin/index.js` — current protected admin page shell and SSR guard behavior
- `styles/Admin.module.scss` — existing admin page styling baseline
- `components/layout/Sidebar.js` — admin navigation entrypoint pattern
- `lib/AppContext.js` — existing admin access recheck loop while on `/admin*`
- `lib/requireAdmin.js` — admin API enforcement wrapper
- `pages/api/admin/enqueue-artists.js` — bulk enqueue contract and reason-code semantics
- `pages/api/admin/retry-jobs.js` — retry contract and reason-code semantics
- `models/ArtistJob.js` — job status model and fields required for dashboard visibility
- `workers/artistExpandWorker.js` — real worker-driven status transitions that dashboard must reflect
- `lib/artistExpandQueue.js` — queue isolation and enqueue contract used by admin actions

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `pages/admin/index.js` already provides protected admin route shell and can be expanded into the dashboard.
- `styles/Admin.module.scss` already defines admin page visual primitives (`adminWrap`, `adminHeader`, `adminBody`).
- Phase 2 endpoints already implement bulk action semantics; Phase 3 UI can consume them directly.
- `ArtistJob` already includes status and timing/error fields required by visibility requirements.

### Established Patterns
- Admin protection is defense-in-depth (`middleware` + SSR/admin wrappers), so dashboard work should stay inside `/admin` and `/api/admin/*`.
- Mixed-result admin actions return HTTP 200 with per-item result objects and reason codes.
- Worker lifecycle updates persistent Mongo state; UI should read and display persisted fields instead of inferring status.

### Integration Points
- Extend `/admin` page UI and add/read supporting admin API endpoints for job listing/filtering if needed.
- Connect dashboard actions to existing enqueue/retry endpoints without altering queue architecture.
- Render failures and recency from `ArtistJob.error` and `updatedAt`, and reflect retry transitions from the same record lifecycle.

</code_context>

<deferred>
## Deferred Ideas

- Saved filter presets and queue health cards (`OPS-01`, `OPS-02`) — v2 scope.
- Preflight "impact preview" before bulk queue (`OPS-03`) — v2 scope.
- Multi-admin role model — out of scope for current single-admin policy.

</deferred>

---

*Phase: 03-admin-expansion-dashboard*  
*Context gathered: 2026-04-14*
