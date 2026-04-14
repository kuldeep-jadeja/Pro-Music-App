# Pitfalls Research: Admin Artist Expansion Controls

**Date:** 2026-04-14

## High-Risk Pitfalls

### 1) Missing server-side admin guard
- **Symptom:** non-admin users can call admin APIs.
- **Prevention:** enforce `requireAdmin` on every admin endpoint.

### 2) Duplicate jobs from bulk actions
- **Symptom:** repeated clicks enqueue same artist multiple times.
- **Prevention:** dedupe key + atomic upsert + per-item result summary.

### 3) Job loss/stuck state on worker crash
- **Symptom:** jobs disappear or remain `running` forever.
- **Prevention:** stale-job reconciliation + heartbeat + retry policy.

### 4) Admin queue floods user-facing workload
- **Symptom:** match/enrichment throughput degrades.
- **Prevention:** separate queue key and batch-size/rate limits for bulk enqueue.

## Warning Signals

- Rapid queue depth growth with no running workers
- Rising failed count and repeated same error
- Oldest queued age increasing beyond expected SLA
