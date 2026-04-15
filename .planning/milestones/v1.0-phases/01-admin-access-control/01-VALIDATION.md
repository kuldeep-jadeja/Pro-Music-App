---
phase: 1
slug: admin-access-control
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-14
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Next.js build smoke baseline (no dedicated test framework yet) |
| **Config file** | none — Wave 0 installs if deeper automated tests are required |
| **Quick run command** | `npm test` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~60 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test`
- **After every plan wave:** Run `npm test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 120 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 01-01-01 | 01 | 1 | ADMIN-01 | build-smoke | `npm test` | ✅ | ⬜ pending |
| 01-01-02 | 01 | 1 | ADMIN-02 | build-smoke | `npm test` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Add focused API authorization tests for `/api/admin/*` responses (401/403/200 paths)
- [ ] Add page-route access tests for `/admin/*` redirect behavior

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Redirect UX and message timing for non-admin users | ADMIN-01, ADMIN-02 | Requires browser navigation and UI feedback confirmation | Sign in as non-admin, open `/admin/*`, confirm redirect to `/` plus "Admin access required" message |
| 5-minute recheck + immediate API 403 precedence | ADMIN-01, ADMIN-02 | Session timing and runtime state transition are integration-level | Open admin page as admin, revoke admin status, trigger admin API before and after interval; confirm immediate block on first 403 |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
