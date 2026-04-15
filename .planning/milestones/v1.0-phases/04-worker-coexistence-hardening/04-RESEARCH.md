# Phase 4: Worker Coexistence Hardening - Research

**Researched:** 2026-04-15  
**Domain:** Multi-worker queue coexistence hardening (Next.js + Redis + Mongo workers)  
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
### Coexistence test scope
- Validate coexistence against these active workers explicitly: `metadataWorker`, `artistCrawler`, `chartsWorker`, `ytMatchWorker`, and `artistExpandWorker`.
- Validate core user-facing flows during coexistence:
  - import playlist flow (`/api/import-playlist` + matching progress),
  - playlist/status polling (`/api/playlists`, `/api/playlist/[id]/status`),
  - admin enqueue/retry paths already implemented in earlier phases.
- Coexistence verification must include both "during expansion queue activity" and "after expansion activity" checks.

### Load profile and run mode
- Use realistic sustained queue activity (not synthetic extreme stress) as the default run mode for v1 hardening.
- Use mixed workload overlap: artist expansion jobs queued while yt-match and metadata queues are also active.
- Prefer repeatable operator-run scenarios that can be re-executed during UAT, rather than one-off ad hoc observations.

### Regression signals and pass/fail policy
- Treat the following as blocking regressions for SYNC-02:
  - existing workers stop consuming their own queues,
  - playlist import/matching user flows stall unexpectedly,
  - repeated worker-loop crashes or unbounded error growth during coexistence runs.
- Require explicit evidence that queue isolation still holds:
  - artist expansion remains on `demus:artist-expand:queue`,
  - yt-match remains on `demus:ytmatch:queue`,
  - metadata remains on `demus:metadata:queue`.
- Require observable "no regression" outcome, not just process liveness logs.

### Recovery and operator handling
- If coexistence degradation is observed, the immediate phase response is diagnose-and-fix within Phase 4 scope (no silent acceptance).
- Keep queue-safe semantics from prior phases unchanged while hardening coexistence.
- Do not introduce force-run bypasses or cross-queue consumer shortcuts as a mitigation strategy.

### Claude's Discretion
- Exact instrumentation shape (structured logs, counters, lightweight diagnostics endpoint/test script wiring) as long as coexistence evidence is clear and repeatable.
- Exact scenario sequencing and run durations, as long as the required overlap and pass/fail signals above are covered.
- Exact packaging of verification artifacts (report format, checklist layout) as long as downstream verifier/UAT can use them directly.

### Deferred Ideas (OUT OF SCOPE)
- Advanced queue telemetry dashboards (depth/lag visual cards) — future ops enhancement.
- Automated worker autoscaling/priority scheduling policy — future hardening phase.
- Multi-tenant or multi-admin operational controls — out of scope for v1.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SYNC-02 | Existing background workers continue processing without regression while admin expansion jobs are queued. | Queue isolation verification, mixed-workload scenario matrix, regression/pass-fail signals, and coexistence validation architecture. |
</phase_requirements>

## Summary

Phase 4 should focus on **operational proof + hardening**, not new product features. The codebase already has isolated queue keys and dedicated consumers (`artistExpandWorker` BLPOP on `demus:artist-expand:queue`, `ytMatchWorker` BLPOP on `demus:ytmatch:queue`, `metadataWorker` BLPOP on `demus:metadata:queue`). The biggest practical coexistence risk is not key collision; it is **shared downstream pressure** (artist expansion, charts, and crawler all enqueue into yt-match queue), which can slow user-visible import progression.

Use a repeatable coexistence matrix that captures **before / during / after** behavior for SYNC-02 with blocking regression criteria tied to real flows: import playlist, status polling, and admin enqueue/retry. Keep Phase 2 queue-safe semantics unchanged.

**Primary recommendation:** Implement a repeatable mixed-load coexistence runner + evidence checklist around existing queues/workers; do not change queue topology.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| next | 16.1.6 (repo), latest 16.2.3 verified | API routes + app runtime | Existing production framework; Phase 4 is hardening, not migration. |
| ioredis | 5.10.0 (repo), latest 5.10.1 verified | Queue transport (`RPUSH`/`BLPOP`) | Already used by all worker queue paths. |
| mongoose | 9.2.3 (repo), latest 9.4.1 verified | Persistent job/playlist/track state | Existing source of truth for worker outcomes. |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| spotify-url-info | 3.2.18 (repo), latest 3.3.0 verified | Artist/charts crawling data source | Used by crawler/expand workers in coexistence runs. |
| yt-search | 2.13.1 (repo & latest) | YouTube match lookup in worker | Critical downstream queue consumer behavior. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Existing Redis list queues + current workers | BullMQ / RabbitMQ / priority scheduler | Large architecture change; out of scope for SYNC-02 hardening. |

**Installation:**
```bash
# No new package required for Phase 4 baseline.
npm install
```

**Version verification:** verified with `npm view <package> version` and `npm view <package> time`.

## Architecture Patterns

### Recommended Project Structure
```text
scripts/
├── workerCoexistenceMatrix.js   # repeatable before/during/after coexistence runner
└── workerCoexistenceReport.js   # summarizes queue depth + flow outcomes
tests/
└── worker-coexistence.smoke.js  # lightweight contract checks for queue isolation evidence
docs/
└── phase-04-coexistence.md      # operator/UAT runbook + pass/fail checklist
```

### Pattern 1: Queue Isolation + Downstream Coupling Awareness
**What:** Keep strict queue consumer boundaries while measuring cross-flow impact on shared downstream queue (`demus:ytmatch:queue`).  
**When to use:** Always in SYNC-02 runs with overlapping expansion + import activity.  
**Example:**
```js
// Source: workers/artistExpandWorker.js
const ARTIST_EXPAND_QUEUE_KEY = 'demus:artist-expand:queue';
const YTMATCH_QUEUE_KEY = 'demus:ytmatch:queue'; // outbound only (RPUSH), never BLPOP
const result = await redis.blpop(ARTIST_EXPAND_QUEUE_KEY, 30);
```

### Anti-Patterns to Avoid
- **Cross-queue shortcutting:** do not let expansion worker consume yt-match queue.
- **Liveness-only validation:** process-alive logs are insufficient without user-flow checks.
- **Topology refactor in hardening phase:** no queue tech swap in SYNC-02 scope.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| New queue orchestration | Ad-hoc priority broker | Existing `artistExpandQueue`, `redisQueue`, `metadataQueue` helpers | Queue keys and semantics are already contractual from prior phases. |
| New admin execution bypass | Direct worker invocation endpoint | Existing `/api/admin/enqueue-artists` + `/api/admin/retry-jobs` | Preserves queue-safe semantics and traceability. |
| Custom state source for dashboard | In-memory worker status cache | `ArtistJob` + existing APIs | Dashboard and verification already depend on persisted server truth. |

**Key insight:** Regression risk is operational overlap, not missing infrastructure.

## Common Pitfalls

### Pitfall 1: False "healthy" signal from metadata shadow mode
**What goes wrong:** `metadataWorker` appears alive but may be no-op (`METADATA_WORKER_SHADOW_MODE=true` default).  
**How to avoid:** Explicitly lock run mode for coexistence evidence (document whether shadow mode is on/off and expected behavior).

### Pitfall 2: Shared yt-match queue starvation perception
**What goes wrong:** expansion/crawler/charts enqueue surge delays playlist matching, read as regression.  
**How to avoid:** Track queue depth and playlist status latency during overlap; define pass thresholds.

### Pitfall 3: One-shot workers mistaken for daemons
**What goes wrong:** `artistCrawler`/`chartsWorker` naturally exit after batch and are treated as crashes.  
**How to avoid:** Validate expected lifecycle per worker type in runbook.

## Code Examples

### Queue isolation evidence checks
```js
// Source: lib/artistExpandQueue.js, lib/redisQueue.js, lib/metadataQueue.js
export const ARTIST_EXPAND_QUEUE_KEY = 'demus:artist-expand:queue';
export const QUEUE_KEY = 'demus:ytmatch:queue';
export const METADATA_QUEUE_KEY = 'demus:metadata:queue';
```

### Import flow remains queue-based under load
```js
// Source: pages/api/import-playlist.js
if (uncachedTracks.length > 0) {
  const canMatch = await Playlist.findOneAndUpdate(
    { _id: playlist._id, status: { $ne: 'matching' } },
    { $set: { status: 'matching' } }
  );
  if (canMatch) batchMatchTracks(uncachedTracks, playlist._id, 1000);
}
enqueueMetadataBatch(rawTracks, context);
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Single in-process matching guard only | Redis queue + dedicated `ytMatchWorker` BLPOP consumer | Existing current architecture | Better multi-process safety for matching throughput control. |
| Spotify OG tier in enrichment comments | Worker comments now mark OG scrape removed due Spotify SPA | Current worker code | Avoid planning around deprecated enrichment tier. |

**Deprecated/outdated:**
- README pipeline text still mentions Spotify OG tier in one section; worker implementations indicate removal. Treat worker code as canonical.

## Open Questions

1. **What exact latency/error thresholds define "no regression" for SYNC-02?**
   - What we know: blocking regressions are defined qualitatively in context.
   - What's unclear: numeric thresholds for queue lag/import completion.
   - Recommendation: set explicit phase gate thresholds in Plan 1.

2. **Will coexistence validation run with metadata shadow mode on or off?**
   - What we know: default env in worker is shadow mode enabled.
   - What's unclear: expected production mode for SYNC-02 evidence.
   - Recommendation: decide and document expected mode before execution.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Node script-based checks (no Jest/Vitest config detected) |
| Config file | none — see Wave 0 |
| Quick run command | `node tests/worker-coexistence.smoke.js` |
| Full suite command | `npm run build && node tests/worker-coexistence.smoke.js` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SYNC-02 | Existing workers keep processing during expansion queue activity and core flows remain functional | integration/smoke | `node tests/worker-coexistence.smoke.js` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `node tests/worker-coexistence.smoke.js`
- **Per wave merge:** `npm run build && node tests/worker-coexistence.smoke.js`
- **Phase gate:** Full suite green + coexistence evidence captured before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `tests/worker-coexistence.smoke.js` — SYNC-02 automated coexistence smoke
- [ ] `scripts/workerCoexistenceMatrix.js` — repeatable mixed-load scenario runner
- [ ] `docs/phase-04-coexistence.md` — operator checklist + pass/fail evidence template

## Sources

### Primary (HIGH confidence)
- `.planning/phases/04-worker-coexistence-hardening/04-CONTEXT.md` - locked decisions and scope.
- `workers/artistExpandWorker.js`, `workers/ytMatchWorker.js`, `workers/metadataWorker.js`, `workers/artistCrawler.js`, `workers/chartsWorker.js` - runtime queue/worker behavior.
- `lib/artistExpandQueue.js`, `lib/redisQueue.js`, `lib/metadataQueue.js` - queue key contracts.
- `pages/api/import-playlist.js`, `pages/api/playlists.js`, `pages/api/playlist/[id]/status.js` - user-flow integration points.
- `package.json` + `npm view` registry checks - version and currency validation.

### Secondary (MEDIUM confidence)
- `README.md` - architecture narrative (validated against code where conflicting).

### Tertiary (LOW confidence)
- None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - verified against repo + npm registry.
- Architecture: HIGH - derived directly from active worker/API codepaths.
- Pitfalls: MEDIUM-HIGH - code-backed plus operational inference for overlap behavior.

**Research date:** 2026-04-15  
**Valid until:** 2026-05-15
