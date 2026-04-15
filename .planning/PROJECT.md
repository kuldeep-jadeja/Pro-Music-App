# Demus (Pro-Music-App)

## What This Is

Demus is a full-stack music streaming PWA that imports public Spotify playlists, matches tracks to YouTube, and plays them through a persistent global player. It includes worker-driven background enrichment and admin-operated artist expansion controls that are now shipped in v1.0.

## Core Value

Turn Spotify playlist discovery into reliable, always-available playback with fast worker-backed enrichment while keeping operator controls simple and safe.

## Requirements

### Validated

- ✓ Import public Spotify playlists and persist tracks/playlists in MongoDB — existing
- ✓ Match tracks to YouTube IDs via queued worker processing — existing
- ✓ Play tracks through a global, route-persistent YouTube player — existing
- ✓ Show playlist and track library UI with now-playing and queue interactions — existing
- ✓ Admin-only page shows artist expansion jobs with filters and operational state visibility — v1.0
- ✓ Admin can multi-select artists and bulk queue expansion jobs — v1.0
- ✓ Admin access is restricted to a single configured email — v1.0
- ✓ Expansion queue activity coexists with existing worker flows using matrix/report/smoke verification tooling — v1.0

### Active

- [ ] OPS-01: Save and reuse dashboard filter presets
- [ ] OPS-02: Queue health cards (depth, lag, worker heartbeat)
- [ ] OPS-03: Bulk enqueue impact preview
- [ ] Reduce cross-phase drift by consuming shared admin dashboard contract constants in API and UI

### Out of Scope

- Non-admin access to artist expansion controls — restricted for operational safety
- Auto-expanding every artist without manual selection — explicit operator control required

## Context

This is a brownfield Next.js Pages Router app with workers for YouTube matching, metadata enrichment, artist crawling, and artist expansion. Playback architecture remains stable (`PlayerContext`), app-level browsing state remains in `AppContext`, and v1.0 shipped admin expansion controls plus coexistence validation tooling.

## Constraints

- **Access Control**: Single configured admin email — limit privileged actions to one operator
- **Architecture**: Reuse existing worker/job pipeline for artist expansion — avoid introducing a parallel orchestration path
- **Framework**: Next.js Pages Router conventions must remain intact — preserve current app structure and patterns

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Admin page access uses one configured email | Fastest secure gate for current operator workflow | Implemented — middleware + API guards in Phase 1 |
| Artist selection uses multi-select with bulk queue action | Efficiently manage many artists at once | Implemented — dashboard bulk enqueue in Phase 3 |
| Page includes all states with filters | Gives full operational visibility, not just active jobs | Implemented — jobs API + dashboard filters in Phase 3 |
| Selection queues jobs only (no forced immediate run) | Keeps worker scheduling behavior consistent and predictable | Implemented — queue-safe orchestration preserved in Phases 2-4 |

## Current State (v1.0 Shipped)

- Milestone v1.0 archived with 4 phases complete (11 plans, 17 tasks).
- All v1 requirements are satisfied and traced.
- Cross-phase integration has no blockers; remaining items are tracked as tech debt.

## Next Milestone Goals

- Define vNext requirements and roadmap with `/gsd-new-milestone`.
- Address operational enhancements (OPS-01..OPS-03).
- Improve Nyquist compliance and reduce contract drift risks identified in the v1.0 audit.

---
*Last updated: 2026-04-15 after v1.0 milestone archive*
