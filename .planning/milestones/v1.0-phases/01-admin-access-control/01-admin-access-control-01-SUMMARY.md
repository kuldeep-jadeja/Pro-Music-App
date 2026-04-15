---
phase: 01-admin-access-control
plan: 01
subsystem: auth
tags: [jwt, next.js, api, authorization, admin, environment-variable]

# Dependency graph
requires: []
provides:
  - Server-side admin email identity utility (normalizeEmail, isAdminEmail)
  - Composable requireAdmin API guard wrapping requireAuth + 403 for non-admin
  - Protected admin probe endpoint GET /api/admin/access-check
  - Protected catch-all fallback for unknown /api/admin/* routes
  - isAdmin flag in /api/auth/me session payload
affects:
  - 01-admin-access-control (plan 02 — page-level route guards and navbar)
  - Any future /api/admin/* route (inherits guard by catch-all)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "requireAdmin(handler): composable HOF wrapping requireAuth + admin email check"
    - "normalizeEmail via trim().toLowerCase() before identity comparison"
    - "Fail-closed on missing ADMIN_EMAIL with one-time server warning log"
    - "Catch-all route guard prefix pattern for /api/admin/*"

key-files:
  created:
    - lib/adminAccess.js
    - lib/requireAdmin.js
    - pages/api/admin/access-check.js
    - pages/api/admin/[...path].js
  modified:
    - pages/api/auth/me.js

key-decisions:
  - "Compose requireAdmin on top of requireAuth — no auth logic duplication"
  - "ADMIN_EMAIL fail-closed with one-time console.warn to avoid log flooding"
  - "Catch-all /api/admin/[...path].js ensures future routes are guarded by default"
  - "isAdmin computed server-side via isAdminEmail and surfaced in /api/auth/me payload"

patterns-established:
  - "requireAdmin: wrap with requireAuth first, then isAdminEmail check, return 403 for non-admin"
  - "normalizeEmail: trim().toLowerCase() on both sides before comparison"

requirements-completed:
  - ADMIN-02

# Metrics
duration: 3min
completed: 2026-04-14
---

# Phase 01 Plan 01: Admin Access Control - Admin Guard Utilities Summary

**Server-side admin identity guard (normalizeEmail + isAdminEmail + requireAdmin HOF) with prefix-wide /api/admin/* protection and isAdmin in the /api/auth/me session payload**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-04-14T08:12:31Z
- **Completed:** 2026-04-14T08:15:26Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Created `lib/adminAccess.js` with `normalizeEmail` and `isAdminEmail` helpers; fail-closed when `ADMIN_EMAIL` is missing with a single server warning
- Created `lib/requireAdmin.js` composing `requireAuth` and returning HTTP 403 for authenticated non-admin users
- Extended `pages/api/auth/me.js` to include `isAdmin` in the user payload (computed server-side, `ADMIN_EMAIL` never exposed to client)
- Added `pages/api/admin/access-check.js` as the admin identity probe endpoint (GET, `requireAdmin` wrapped)
- Added `pages/api/admin/[...path].js` as a guarded catch-all so all future `/api/admin/*` routes are admin-protected by default

## Task Commits

Each task was committed atomically:

1. **Task 1: Create canonical admin identity + API guard utilities** - `623a205` (feat)
2. **Task 2: Enforce /api/admin/* guard coverage and expose admin status probe** - `3b44163` (feat)

**Plan metadata:** TBD (docs: complete plan)

## Files Created/Modified

- `lib/adminAccess.js` - normalizeEmail + isAdminEmail helpers; fail-closed on missing ADMIN_EMAIL
- `lib/requireAdmin.js` - HOF composing requireAuth + 403 admin gate
- `pages/api/auth/me.js` - Added isAdmin to returned user object
- `pages/api/admin/access-check.js` - Admin probe endpoint (GET only, requireAdmin wrapped)
- `pages/api/admin/[...path].js` - Catch-all admin fallback returning 404 after admin auth

## Decisions Made

- Composed `requireAdmin` on top of existing `requireAuth` (no auth logic duplication) — consistent with established wrapper pattern in the codebase
- `ADMIN_EMAIL` fail-closed: when env var is unset, `isAdminEmail` returns false and emits one `console.warn` per server lifecycle to avoid flooding logs
- Catch-all route added immediately so future `/api/admin/*` additions don't require manual guard wiring
- `isAdmin` included in `/api/auth/me` response to enable client-side conditional rendering without leaking `ADMIN_EMAIL` to the browser

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

**Environment variable required before admin access works:**

Add the following to `.env.local`:

```
ADMIN_EMAIL=your-admin-email@example.com
```

Without this variable, all admin API access will be denied and a server warning will be logged.

## Next Phase Readiness

- Admin API authorization layer is complete and reusable
- `requireAdmin` is ready to be applied to all future admin API handlers
- `isAdmin` in `/api/auth/me` enables page-level guard implementation in Plan 02
- Next plan should implement page-level route guards for `/admin/*` pages and conditional admin navigation rendering

## Self-Check: PASSED

- lib/adminAccess.js: FOUND
- lib/requireAdmin.js: FOUND
- pages/api/auth/me.js: FOUND (isAdmin added)
- pages/api/admin/access-check.js: FOUND
- pages/api/admin/[...path].js: FOUND
- SUMMARY.md: FOUND
- Commits 623a205, 3b44163: FOUND in git log
- Next.js build: PASSED (all routes present in build output)

---
*Phase: 01-admin-access-control*
*Completed: 2026-04-14*
