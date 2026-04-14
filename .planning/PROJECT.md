# Demus (Pro-Music-App)

## What This Is

Demus is a full-stack music streaming PWA that imports public Spotify playlists, matches tracks to YouTube, and plays them through a persistent global player. It includes worker-driven background enrichment and expansion flows for library data. The current focus is adding an admin-only control surface for artist expansion operations.

## Core Value

Turn Spotify playlist discovery into reliable, always-available playback with fast worker-backed enrichment while keeping operator controls simple and safe.

## Requirements

### Validated

- ✓ Import public Spotify playlists and persist tracks/playlists in MongoDB — existing
- ✓ Match tracks to YouTube IDs via queued worker processing — existing
- ✓ Play tracks through a global, route-persistent YouTube player — existing
- ✓ Show playlist and track library UI with now-playing and queue interactions — existing

### Active

- [ ] Admin-only page shows all artist expansion jobs with filters (queued/running/done/failed)
- [ ] Admin can multi-select artists and bulk queue expansion jobs
- [ ] Admin access is restricted to a single configured email

### Out of Scope

- Non-admin access to artist expansion controls — restricted for operational safety
- Auto-expanding every artist without manual selection — explicit operator control required

## Context

This is a brownfield Next.js Pages Router app with existing workers for YouTube matching, metadata enrichment, and artist crawling. Playback architecture is stable and centralized in `PlayerContext`, while app-level browsing state is in `AppContext`. The new admin page should integrate with existing artist expansion workers without disrupting current playback or import flows.

## Constraints

- **Access Control**: Single configured admin email — limit privileged actions to one operator
- **Architecture**: Reuse existing worker/job pipeline for artist expansion — avoid introducing a parallel orchestration path
- **Framework**: Next.js Pages Router conventions must remain intact — preserve current app structure and patterns

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Admin page access uses one configured email | Fastest secure gate for current operator workflow | — Pending |
| Artist selection uses multi-select with bulk queue action | Efficiently manage many artists at once | — Pending |
| Page includes all states with filters | Gives full operational visibility, not just active jobs | — Pending |
| Selection queues jobs only (no forced immediate run) | Keeps worker scheduling behavior consistent and predictable | — Pending |

---
*Last updated: 2026-04-14 after initialization*
