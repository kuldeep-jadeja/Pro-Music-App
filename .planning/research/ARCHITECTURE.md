# Architecture Research: Admin Artist Expansion Controls

**Date:** 2026-04-14

## Recommended Pattern

Control plane + worker plane:

- **Control plane:** `pages/admin/*` + `pages/api/admin/*` for listing/filtering/enqueue/retry.
- **Worker plane:** existing worker process consumes queue and performs expansion.
- **State split:** MongoDB for durable job state; Redis for queue transport.

## Integration Points

1. Add server-side `requireAdmin` wrapper (single configured admin email).
2. Add `ArtistExpansionJob` model with status lifecycle and error metadata.
3. Add admin APIs:
   - `GET /api/admin/artist-jobs`
   - `POST /api/admin/artist-jobs/enqueue`
   - `POST /api/admin/artist-jobs/:id/retry`
4. Add admin page with filters + multi-select bulk enqueue.

## Data Flow

1. Admin selects artists and submits bulk enqueue.
2. API validates payload and writes/upserts queued jobs in Mongo.
3. API pushes job IDs to Redis artist-expansion queue.
4. Worker pops jobs, updates state (`running`→`done`/`failed`), writes errors/retry metadata.
5. Dashboard polls list endpoint and renders current state.

## Key Risks

- Duplicate enqueue without idempotency.
- Stale `running` jobs after worker crash.
- Queue starvation if admin workload is unbounded.
