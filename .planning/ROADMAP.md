# Roadmap: Demus Admin Artist Expansion Controls

## Phases

- [x] **Phase 1: Admin Access Control** - Only the configured admin can open and use artist-expansion surfaces. (completed 2026-04-14)
- [x] **Phase 2: Queue-Safe Job Actions** - Enqueue/retry flows are reliable, idempotent, and routed through existing queue orchestration. (completed 2026-04-14)
- [ ] **Phase 3: Admin Expansion Dashboard** - Admin can view, filter, and act on artist expansion jobs with accurate state visibility.
- [ ] **Phase 4: Worker Coexistence Hardening** - Existing worker-driven product behavior remains stable while expansion jobs run.

## Phase Details

### Phase 1: Admin Access Control
**Goal**: Privileged artist expansion operations are securely restricted to the single configured admin identity.
**Depends on**: Nothing (first phase)
**Requirements**: ADMIN-01, ADMIN-02
**Success Criteria** (what must be TRUE):
  1. Signed-in user with the configured admin email can open the admin artist expansion page.
  2. Signed-in non-admin users cannot access admin artist-expansion APIs and receive a forbidden response.
  3. Admin-only behavior is consistently enforced for both page access and API usage.
**Plans:** 2/2 plans complete
Plans:
- [ ] 01-01-PLAN.md — Build server-side admin authorization utilities and `/api/admin/*` guards
- [ ] 01-02-PLAN.md — Implement protected `/admin` page UX, recheck loop, and admin-only navigation

### Phase 2: Queue-Safe Job Actions
**Goal**: Admin-triggered expansion actions behave safely and predictably in the existing queue pipeline.
**Depends on**: Phase 1
**Requirements**: QUEUE-02, QUEUE-03, QUEUE-04, SYNC-01
**Success Criteria** (what must be TRUE):
  1. Repeating the same bulk enqueue request does not create duplicate active jobs for the same artist.
  2. Bulk enqueue results show a per-artist outcome of queued, skipped, or failed.
  3. Admin can retry a failed expansion job and have it return to queue-based processing.
  4. Enqueue and retry actions use the existing worker orchestration path instead of bypassing it.
**Plans:** 4/4 plans complete
Plans:
- [ ] 02-01-PLAN.md — Create ArtistJob model and artistExpandQueue Redis helper (foundation contracts)
- [ ] 02-02-PLAN.md — Implement POST /api/admin/enqueue-artists with idempotent bulk enqueue
- [ ] 02-03-PLAN.md — Implement POST /api/admin/retry-jobs with record reactivation
- [ ] 02-04-PLAN.md — Create artistExpandWorker.js BLPOP consumer for demus:artist-expand:queue

### Phase 3: Admin Expansion Dashboard
**Goal**: Admin can operate artist expansion end-to-end from one dashboard with trustworthy job state.
**Depends on**: Phase 2
**Requirements**: VIS-01, VIS-02, VIS-03, QUEUE-01, SYNC-03
**Success Criteria** (what must be TRUE):
  1. Admin can see artist expansion jobs in queued, running, done, and failed states.
  2. Admin can filter jobs by status and by artist identifier/name to narrow the list quickly.
  3. Admin can select multiple artists and bulk queue expansion jobs from the dashboard.
  4. Failed jobs show failure reason and last updated time.
  5. Job status shown in the dashboard tracks real downstream worker outcomes, including retry transitions.
**Plans:** 2/3 plans complete
Plans:
- [x] 03-01-PLAN.md — Create shared dashboard contract constants and admin read API for artist jobs
- [x] 03-02-PLAN.md — Implement `/admin` dashboard filters/table with server-truth job rendering
- [ ] 03-03-PLAN.md — Add bulk queue + retry UX with polling synchronization

### Phase 4: Worker Coexistence Hardening
**Goal**: Expansion control operations coexist with current background worker behavior without regressions.
**Depends on**: Phase 3
**Requirements**: SYNC-02
**Success Criteria** (what must be TRUE):
  1. While admin queues artist expansion work, existing background workers continue processing normally without observable regressions.
  2. Core user flows that rely on existing workers remain functional during and after admin expansion queue activity.
**Plans**: TBD

## Requirement Coverage Map

| Requirement | Phase |
|-------------|-------|
| ADMIN-01 | Phase 1 |
| ADMIN-02 | Phase 1 |
| QUEUE-01 | Phase 3 |
| QUEUE-02 | Phase 2 |
| QUEUE-03 | Phase 2 |
| QUEUE-04 | Phase 2 |
| VIS-01 | Phase 3 |
| VIS-02 | Phase 3 |
| VIS-03 | Phase 3 |
| SYNC-01 | Phase 2 |
| SYNC-02 | Phase 4 |
| SYNC-03 | Phase 3 |

**Coverage:** 12/12 v1 requirements mapped (100%)

## Progress Table

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Admin Access Control | 2/2 | Complete   | 2026-04-14 |
| 2. Queue-Safe Job Actions | 4/4 | Complete   | 2026-04-14 |
| 3. Admin Expansion Dashboard | 2/3 | In Progress | - |
| 4. Worker Coexistence Hardening | 0/2 | Not started | - |

