# Stack Research: Admin Artist Expansion Controls

**Date:** 2026-04-14  
**Context:** Brownfield Demus app (Next.js Pages Router + MongoDB + Redis + workers)

## Recommended

1. Keep Next.js Pages Router and API routes for admin UI/API.
2. Keep MongoDB as source of truth for artist expansion job state/history.
3. Keep Redis as queue transport (`RPUSH`/`BLPOP`) for worker handoff.
4. Add `zod` for admin API payload/query validation.
5. Add `swr` for admin dashboard polling and cache/revalidation.

## Avoid

1. Do not migrate to App Router in this phase.
2. Do not replace queue system (e.g., BullMQ migration) in this phase.
3. Do not add websocket infra for v1; polling is enough for admin ops.

## Confidence

- High: keep existing framework/db/queue architecture.
- High: `zod` for validation.
- Medium: `swr` polling cadence and dashboard ergonomics.
