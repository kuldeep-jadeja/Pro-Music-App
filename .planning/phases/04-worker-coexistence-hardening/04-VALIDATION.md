---
phase: 04
slug: worker-coexistence-hardening
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-15
---

# Phase 04 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node script-based checks (`node`) |
| **Config file** | none — Wave 0 installs/create phase smoke script |
| **Quick run command** | `node tests/worker-coexistence.smoke.js` |
| **Full suite command** | `npm run build && node tests/worker-coexistence.smoke.js` |
| **Estimated runtime** | ~120 seconds |

---

## Sampling Rate

- **After every task commit:** Run `node tests/worker-coexistence.smoke.js`
- **After every plan wave:** Run `npm run build && node tests/worker-coexistence.smoke.js`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 120 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 04-01-01 | 01 | 1 | SYNC-02 | integration/smoke | `node tests/worker-coexistence.smoke.js --check queue-isolation` | ❌ W0 | ⬜ pending |
| 04-01-02 | 01 | 1 | SYNC-02 | integration/smoke | `node tests/worker-coexistence.smoke.js --check user-flows` | ❌ W0 | ⬜ pending |
| 04-02-01 | 02 | 2 | SYNC-02 | integration/smoke | `node tests/worker-coexistence.smoke.js --check overlap-regressions` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/worker-coexistence.smoke.js` — automated SYNC-02 coexistence smoke checks
- [ ] `scripts/workerCoexistenceMatrix.js` — repeatable before/during/after mixed-load scenario runner
- [ ] `docs/phase-04-coexistence.md` — operator checklist and evidence capture template

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Existing workers remain observable and healthy during admin enqueue/retry overlap | SYNC-02 | Requires runtime environment overlap and operator confirmation against live queue activity | Run coexistence matrix, trigger admin enqueue/retry and import-playlist overlap, confirm no stalled flows and no repeated worker-loop failures in evidence report. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
