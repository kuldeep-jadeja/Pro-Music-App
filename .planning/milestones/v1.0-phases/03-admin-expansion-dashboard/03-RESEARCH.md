# Phase 3: Admin Expansion Dashboard - Research

**Researched:** 2026-04-14  
**Domain:** Admin job operations dashboard (Next.js Pages + Mongo + Redis worker state)  
**Confidence:** HIGH

<user_constraints>
## Locked Decisions (from 03-CONTEXT.md)

- Build the dashboard on `/admin` with two sections: **Bulk Queue Controls** and **Jobs Table**.
- Use a dense table view (not cards), sorted by `updatedAt` descending.
- Table must expose: status, artist, artist Spotify ID, last updated, failure reason, row actions.
- Filters: status (`all/queued/running/done/failed`) + text query (artist name or Spotify ID), combinable.
- Multi-select with per-row + select-all-visible behavior.
- Queue actions must reuse existing APIs (`/api/admin/enqueue-artists`, `/api/admin/retry-jobs`) and preserve per-item reason semantics.
- Dashboard state must be server-truth from `ArtistJob`; refresh after actions + periodic polling.
</user_constraints>

<phase_requirements>
## Requirement Mapping

| ID | Implementation implication |
|----|----------------------------|
| VIS-01 | Read/list jobs by status across `queued/running/done/failed` |
| VIS-02 | Combined status + search filtering by artist name / Spotify ID |
| VIS-03 | Render failure reason + last-updated value for failed jobs |
| QUEUE-01 | Multi-select artists and bulk enqueue from dashboard |
| SYNC-03 | Dashboard reflects real worker outcomes (no client-synthesized status) |
</phase_requirements>

## Summary

Phase 3 should extend the existing protected `/admin` page and introduce a read endpoint for job visibility. Queue-safe write paths already exist and should be reused as-is. The key architectural rule is to treat `ArtistJob` as the source of truth and keep the UI synchronized through explicit refreshes and polling.

## Standard Stack

| Layer | Existing standard |
|------|--------------------|
| Web | Next.js Pages Router (`pages/admin/index.js`, `pages/api/admin/*`) |
| Data | Mongoose model `ArtistJob` |
| Queue | Redis list + dedicated worker (`demus:artist-expand:queue`, `artistExpandWorker.js`) |
| Auth | `requireAdmin` + middleware `/admin*` gate |

No new package is required for baseline Phase 3.

## Architecture Recommendations

### 1. Add read endpoint for dashboard visibility
- Add `GET /api/admin/artist-jobs` under `/pages/api/admin/`.
- Wrap with `requireAdmin`, call `connectDB`.
- Support query params: `status`, `q`, `limit`, `cursor/page` (exact paging strategy can be decided in planning).
- Sort by `updatedAt` descending.
- Return fields needed by UI: `_id`, `artistName`, `artistSpotifyId`, `status`, `error`, `updatedAt`, `queuedAt`, `startedAt`, `completedAt`, `retriedAt`.

### 2. Keep write semantics via existing endpoints
- Queue new/bulk actions through `POST /api/admin/enqueue-artists`.
- Retry failed rows through `POST /api/admin/retry-jobs`.
- Preserve result rendering by reason code (`queued`, `already_active`, `missing_artist_id`, `retry_queued`, `job_not_found`, etc.).

### 3. Server-truth UI state model
- Fetch jobs from read endpoint using current filters.
- After enqueue/retry, refetch immediately.
- Poll while page is open (interval constant in page/module).
- Reconcile selected rows after each refresh/filter change (drop stale/non-visible selections when required by UX decision).

## Existing Reusable Assets

- `pages/admin/index.js` already has protected shell + admin SSR guard.
- `styles/Admin.module.scss` already contains admin layout primitives.
- `pages/api/admin/enqueue-artists.js` and `pages/api/admin/retry-jobs.js` implement queue-safe result semantics.
- `models/ArtistJob.js` already has required status/error/timestamps.
- `workers/artistExpandWorker.js` already writes lifecycle transitions (`queued -> running -> done/failed`).
- `lib/AppContext.js` already demonstrates admin-route polling/recheck patterns.

## Codebase Risks and Mitigations

1. **Search regex issues**  
   - Risk: invalid/surprising regex behavior from raw user input.  
   - Mitigation: escape query before Mongo `$regex`.

2. **Polling leaks / duplicate intervals**  
   - Risk: runaway requests after navigation/re-renders.  
   - Mitigation: one scoped polling effect with cleanup.

3. **Selection drift after filter refresh**  
   - Risk: hidden rows remain selected and get bulk-queued unintentionally.  
   - Mitigation: reconcile selected IDs against current result set each refresh.

4. **Misclassifying `skipped` as failure**  
   - Risk: operator confusion and unnecessary retries.  
   - Mitigation: display queued/skipped/failed as distinct outcome classes.

## Recommended Planning Slices

1. **API visibility slice** — implement `GET /api/admin/artist-jobs` with filtering/sorting.
2. **Dashboard rendering slice** — replace placeholder with filters + dense jobs table + empty states.
3. **Bulk enqueue UX slice** — selection model and enqueue action integration + outcome rendering.
4. **Retry + sync slice** — row retry integration, immediate refresh, polling behavior.
5. **Hardening slice** — search escaping, selection reconciliation, UX clarity for reason codes.

## Validation Architecture

### Commands available in current repo
- Build/type safety gate: `npm run build`
- (No dedicated test harness detected for this surface in current baseline)

### Requirement-level verification expectations
| Requirement | Verification target |
|-------------|---------------------|
| VIS-01 | Jobs list can show each status class |
| VIS-02 | Combined status + query filter behavior works |
| VIS-03 | Failed rows show `error` + `updatedAt` |
| QUEUE-01 | Multi-select bulk enqueue returns/rendered per-item outcomes |
| SYNC-03 | Worker transitions appear in dashboard after refresh/poll |

### Nyquist notes
- Plan tasks should include grep/read-verifiable acceptance criteria.
- Because repo currently lacks dedicated automated tests for this feature area, plans should include concrete manual/UAT verification steps alongside build gate.

## Canonical Files Consulted

- `.planning/phases/03-admin-expansion-dashboard/03-CONTEXT.md`
- `.planning/ROADMAP.md`
- `.planning/REQUIREMENTS.md`
- `.planning/phases/01-admin-access-control/1-CONTEXT.md`
- `.planning/phases/02-queue-safe-job-actions/2-CONTEXT.md`
- `pages/admin/index.js`
- `styles/Admin.module.scss`
- `pages/api/admin/enqueue-artists.js`
- `pages/api/admin/retry-jobs.js`
- `models/ArtistJob.js`
- `workers/artistExpandWorker.js`
- `lib/AppContext.js`
- `lib/requireAdmin.js`
- `components/layout/Sidebar.js`

---

*Phase: 03-admin-expansion-dashboard*  
*Research gathered: 2026-04-14*
