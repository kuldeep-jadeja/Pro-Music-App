# Research Summary: Admin Artist Expansion Controls

**Date:** 2026-04-14

## Stack

Keep current stack and patterns (Next.js Pages Router, MongoDB, Redis queues, worker processes). Add only `zod` (API validation) and `swr` (admin dashboard polling).

## Table Stakes

1. Admin-only access to page and APIs
2. Status-filtered job visibility (`queued`/`running`/`done`/`failed`)
3. Multi-select bulk enqueue
4. Idempotent dedupe for bulk submissions
5. Retry path with visible failure details

## Watch Outs

1. Missing server-side admin authorization
2. Duplicate job creation from repeated submissions
3. Stuck or lost jobs after worker failures
4. Queue overload caused by unbounded bulk actions

## Roadmap Guidance

- Start with access control and job state model.
- Then add admin APIs and queue integration.
- Build dashboard UI after APIs stabilize.
- Add retries, health indicators, and hardening last.
