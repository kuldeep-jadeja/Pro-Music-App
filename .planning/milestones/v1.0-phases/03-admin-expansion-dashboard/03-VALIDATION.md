---
phase: 03
slug: admin-expansion-dashboard
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-14
---

# Phase 03 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | none (current repo baseline for this surface) |
| **Config file** | none — Wave 0 installs |
| **Quick run command** | `npm run build` |
| **Full suite command** | `npm run build` |
| **Estimated runtime** | ~120 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm run build`
- **After every plan wave:** Run `npm run build`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 120 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 03-01-01 | 01 | 1 | VIS-01 | integration | `npm run build` | ❌ W0 | ⬜ pending |
| 03-01-02 | 01 | 1 | VIS-02 | integration | `npm run build` | ❌ W0 | ⬜ pending |
| 03-01-03 | 01 | 1 | VIS-03 | integration | `npm run build` | ❌ W0 | ⬜ pending |
| 03-02-01 | 02 | 2 | QUEUE-01 | integration | `npm run build` | ❌ W0 | ⬜ pending |
| 03-03-01 | 03 | 2 | SYNC-03 | integration | `npm run build` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/admin/artist-jobs.api.test.js` — API filter/query contract stubs for VIS-01/02/03
- [ ] `tests/admin/dashboard.behavior.test.jsx` — dashboard selection/filter behavior stubs for QUEUE-01/SYNC-03
- [ ] `jest` + React Testing Library setup — if test framework adoption is approved for this repo

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Dashboard reflects worker lifecycle transitions (`queued -> running -> done/failed`) | SYNC-03 | Depends on running real worker and queue timing | Queue a test artist from admin dashboard, run worker flow, observe row transitions and refreshed timestamps |
| Mixed-result bulk enqueue rendering (`queued/skipped/failed` with reasons) | QUEUE-01 | Relies on live queue + DB state permutations | Submit mixed selection payload and confirm per-item outcomes/reason codes in UI match API response |
| Failed row retry transition and reason visibility | VIS-03, SYNC-03 | Needs seeded failed-job state and retry path | Trigger retry from failed row, verify transition to queued and refreshed error/updatedAt behavior |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
