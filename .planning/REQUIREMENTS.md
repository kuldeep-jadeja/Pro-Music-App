# Requirements: Demus Admin Artist Expansion Controls

**Defined:** 2026-04-14  
**Core Value:** Turn Spotify playlist discovery into reliable playback with safe operator controls for worker-driven enrichment/expansion.

## v1 Requirements

### Admin Access

- [ ] **ADMIN-01**: Admin can access artist expansion page only when authenticated as the configured admin email
- [ ] **ADMIN-02**: Non-admin authenticated users receive forbidden response for all admin artist-expansion APIs

### Queue Actions

- [ ] **QUEUE-01**: Admin can select multiple artists and bulk enqueue expansion jobs
- [ ] **QUEUE-02**: Bulk enqueue is idempotent and does not create duplicate active jobs for the same artist
- [ ] **QUEUE-03**: Bulk enqueue returns per-artist outcome (queued/skipped/failed)
- [ ] **QUEUE-04**: Admin can retry failed artist expansion jobs

### Visibility

- [ ] **VIS-01**: Admin can view artist expansion jobs by status (`queued`, `running`, `done`, `failed`)
- [ ] **VIS-02**: Admin can filter jobs by status and artist identifier/name
- [ ] **VIS-03**: Admin can see failure reason and last updated time for failed jobs

### Worker Integration

- [ ] **SYNC-01**: Admin artist-expansion enqueue and retry flows reuse existing worker orchestration paths and do not bypass queue-based processing
- [ ] **SYNC-02**: Existing background workers (`metadataWorker`, `artistCrawler`, `chartsWorker`, `ytMatchWorker`, and other active workers) continue processing without regression while admin expansion jobs are queued
- [ ] **SYNC-03**: Artist expansion job status updates remain consistent with downstream worker outcomes (success/failure/retry) so dashboard state reflects real processing state

## v2 Requirements

### Operations Enhancements

- **OPS-01**: Admin can save and reuse dashboard filter presets
- **OPS-02**: Admin can see queue health cards (depth, lag, worker heartbeat)
- **OPS-03**: Admin can preview estimated impact before bulk enqueue

## Out of Scope

| Feature | Reason |
|---------|--------|
| Non-admin access to artist expansion controls | Privileged operations must remain restricted |
| One-click global “expand all artists” action | Unsafe blast radius and high queue starvation risk |
| Forced immediate execution bypassing queue | Must preserve existing worker orchestration path |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| ADMIN-01 | Phase 1 | Pending |
| ADMIN-02 | Phase 1 | Pending |
| QUEUE-01 | Phase 3 | Pending |
| QUEUE-02 | Phase 2 | Pending |
| QUEUE-03 | Phase 2 | Pending |
| QUEUE-04 | Phase 2 | Pending |
| VIS-01 | Phase 3 | Pending |
| VIS-02 | Phase 3 | Pending |
| VIS-03 | Phase 3 | Pending |
| SYNC-01 | Phase 2 | Pending |
| SYNC-02 | Phase 4 | Pending |
| SYNC-03 | Phase 3 | Pending |

**Coverage:**
- v1 requirements: 12 total
- Mapped to phases: 12
- Unmapped: 0 ✅

---
*Requirements defined: 2026-04-14*  
*Last updated: 2026-04-14 after initialization*
