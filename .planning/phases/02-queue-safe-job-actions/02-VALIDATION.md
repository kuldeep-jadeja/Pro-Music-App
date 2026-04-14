---
phase: 02
slug: queue-safe-job-actions
status: draft
nyquist_compliant: false
wave_0_complete: true
created: 2026-04-14
---

# Phase 02 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | None — project uses `npm run test` = `next build` (build-only gate) |
| **Config file** | None (no jest.config.*, no vitest.config.*) |
| **Quick run command** | `npm run build` |
| **Full suite command** | `npm run build` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm run build`
- **After every plan wave:** Run `npm run build`
- **Before `/gsd:verify-work`:** Build green + manual API smoke test
- **Max feedback latency:** ~30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 02-01-01 | 01 | 1 | QUEUE-02 | build + manual | `npm run build` | ❌ W0 n/a | ⬜ pending |
| 02-01-02 | 01 | 1 | QUEUE-03 | build + manual | `npm run build` | ❌ W0 n/a | ⬜ pending |
| 02-01-03 | 01 | 1 | QUEUE-04 | build + manual | `npm run build` | ❌ W0 n/a | ⬜ pending |
| 02-02-01 | 02 | 2 | SYNC-01 | build smoke | `npm run build` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- No unit test infrastructure exists — no Wave 0 installs needed.
- Build gate (`npm run build`) is the project standard for automated verification.

*Existing infrastructure covers all phase requirements via build smoke + manual verification.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Duplicate active job not created on second enqueue | QUEUE-02 | No test runner | POST /api/admin/enqueue twice for same artistId; second response must show status: skipped |
| Per-item results in input order | QUEUE-03 | No test runner | POST /api/admin/enqueue with 3 artistIds; response array order matches input order |
| Retry updates existing record, not creates new | QUEUE-04 | No test runner | POST /api/admin/retry for failed artistId; check MongoDB ArtistJob count stays at 1 |
| No inline execution; Redis enqueue verified | SYNC-01 | Build smoke covers compile | Confirm Redis LPUSH called; no direct worker invocation in enqueue path |

---

## Phase Gate Manual Smoke Test

```bash
# 1. Start dev server with ADMIN_EMAIL, MONGODB_URI, REDIS_URL set
# 2. Enqueue an artist (replace TOKEN and ARTIST_ID)
curl -X POST http://localhost:3000/api/admin/enqueue \
  -H "Cookie: token=TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"artistIds": ["ARTIST_ID"]}'
# Expected: {"results": [{"artistId": "ARTIST_ID", "status": "queued"}]}

# 3. Enqueue again (idempotency check)
# Expected: {"results": [{"artistId": "ARTIST_ID", "status": "skipped"}]}

# 4. Check MongoDB
# Expected: 1 ArtistJob document with status "queued"

# 5. Retry a failed job (set status to "failed" manually first)
curl -X POST http://localhost:3000/api/admin/retry \
  -H "Cookie: token=TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"artistId": "ARTIST_ID"}'
# Expected: {"status": "queued"} and MongoDB doc status resets to "queued"
```

---

## Validation Sign-Off

- [ ] All tasks have `npm run build` as automated verify
- [x] Wave 0: no gaps — build gate is project standard
- [ ] Manual smoke tests documented above are executed before verify-work
- [ ] Build green after each plan wave
- [ ] `nyquist_compliant: true` set in frontmatter after sign-off

**Approval:** pending
