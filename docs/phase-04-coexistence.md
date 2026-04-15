# Phase 04 Coexistence Runbook (SYNC-02)

## Workers in Scope
- metadataWorker
- artistCrawler
- chartsWorker
- ytMatchWorker
- artistExpandWorker

## Queue Keys to Verify
- demus:artist-expand:queue
- demus:ytmatch:queue
- demus:metadata:queue

## Before Run
1. Start app/workers for the scope above.
2. Confirm Redis/Mongo are reachable.
3. Ensure admin enqueue/retry APIs are available.

## During Run
1. Run `npm run coexistence:matrix`.
2. Observe overlap window includes admin expansion + core playlist flows.
3. Confirm no repeated worker-loop crashes or stalled flow responses.

## After Run
1. Run `node scripts/workerCoexistenceReport.js --report graphify-out/worker-coexistence-matrix.json`.
2. Run `npm run coexistence:smoke`.
3. Optional all-in-one command: `npm run coexistence:verify`.

## Blocking Regressions (Fail Phase 4)
- workers_not_consuming
- playlist_flow_stalled
- worker_crash_loop
- queue_isolation_breach

If a blocking regression appears, treat as incident: diagnose-and-fix within Phase 4 scope before sign-off.
