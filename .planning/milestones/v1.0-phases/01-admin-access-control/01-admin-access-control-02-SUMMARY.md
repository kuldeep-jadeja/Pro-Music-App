---
phase: 01-admin-access-control
plan: 02
subsystem: auth
tags: [next.js, middleware, jwt, web-crypto, admin, route-protection, session]

# Dependency graph
requires:
  - phase: 01-admin-access-control plan 01
    provides: requireAdmin HOF, isAdminEmail, /api/admin/access-check endpoint, isAdmin in /api/auth/me
provides:
  - Wildcard /admin/:path* route guard via Next.js edge middleware
  - Edge-compatible JWT verification (Web Crypto HS256, no Node.js dependencies)
  - Email embedded in JWT at login for edge-runtime admin identity checks
  - Admin landing page shell at /admin with getServerSideProps defense-in-depth
  - 5-minute admin access recheck loop in AppContext with immediate 403 redirect
  - Admin-only navigation link in Sidebar (user?.isAdmin conditional)
  - "Admin access required" denial banner on home page via adminAccess=required query flag
affects:
  - 01-admin-access-control (phase complete — all ADMIN-01 + ADMIN-02 requirements met)
  - Any future /admin/* page (covered by wildcard middleware guard by default)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Edge middleware: Web Crypto HS256 JWT verification (no Node.js runtime required)"
    - "Email in JWT payload: signToken(userId, email) for edge-side admin identity checks"
    - "Defense-in-depth: middleware (edge) + getServerSideProps (server) for admin pages"
    - "AppContext recheck loop: useEffect on router.pathname, 5-minute interval, immediate 403 redirect"
    - "user?.isAdmin conditional rendering in Sidebar for admin-only nav entries"
    - "adminAccess=required query flag pattern for denial message UX"

key-files:
  created:
    - middleware.js
    - pages/admin/index.js
    - styles/Admin.module.scss
  modified:
    - lib/AppContext.js
    - lib/auth.js
    - pages/api/auth/login.js
    - components/layout/Sidebar.js
    - pages/index.js
    - styles/Home.module.scss
    - styles/Sidebar.module.scss

key-decisions:
  - "Edge middleware uses Web Crypto for JWT verification — jsonwebtoken is not edge-runtime compatible"
  - "Email embedded in JWT at login so middleware can check admin identity without a DB round-trip"
  - "Defense-in-depth: middleware handles routing, getServerSideProps requireAdmin handles server 403"
  - "Admin recheck loop fires immediately on /admin route mount, then every 300000ms"
  - "First 403/401 from access-check triggers router.replace (not push) to avoid back-button re-trigger"

patterns-established:
  - "middleware.js wildcard pattern: matcher /admin/:path* covers all current + future admin pages"
  - "JWT email embedding: signToken(userId, email) — email is httpOnly cookie payload, never client-visible"
  - "AppContext recheck: useEffect on [router.pathname, user?.id] for route-scoped polling"
  - "Denial banner: query flag adminAccess=required consumed by home page for non-admin redirect feedback"

requirements-completed:
  - ADMIN-01
  - ADMIN-02

# Metrics
duration: ~7min
completed: 2026-04-14
---

# Phase 01 Plan 02: Admin Access Control — Route Guard + UX Summary

**Next.js edge middleware with Web Crypto JWT verification protecting all /admin/:path* routes, 5-minute runtime admin recheck loop in AppContext, admin-only Sidebar nav, and "Admin access required" denial banner**

## Performance

- **Duration:** ~7 min
- **Started:** 2026-04-14T08:41:26Z
- **Completed:** 2026-04-14T08:48:26Z
- **Tasks:** 3
- **Files modified:** 9

## Accomplishments

- Created `middleware.js` with wildcard `/admin/:path*` matcher; edge-compatible HS256 JWT verification using Web Crypto; unauthenticated → `/login`, non-admin → `/?adminAccess=required`, admin → allow through
- Extended `AppContext` with 5-minute admin access recheck loop active only on `/admin/*` routes; first 403/401 immediately triggers `router.replace('/?adminAccess=required')` without waiting for next tick
- Added admin-only Sidebar navigation link (`/admin`) rendered only when `user?.isAdmin === true`; added "Admin access required" denial banner to home page triggered by `adminAccess=required` query flag
- Updated `lib/auth.js` `signToken` to embed email in JWT payload so middleware can compare against `ADMIN_EMAIL` without a database round-trip; `lib/auth.js` change is backward-compatible (email is optional)

## Task Commits

Each task was committed atomically:

1. **Task 1: Enforce wildcard /admin/* route protection and keep admin landing page** - `31493f7` (feat)
2. **Task 2: Add 5-minute admin recheck and immediate 403-first handling** - `ab07e9e` (feat)
3. **Task 3: Restrict admin navigation entry and surface denial message UX** - `4515408` (feat)

**Plan metadata:** TBD (docs: complete plan)

## Files Created/Modified

- `middleware.js` — Edge middleware with Web Crypto JWT verification + wildcard /admin/:path* matcher
- `pages/admin/index.js` — Admin landing shell with getServerSideProps requireAdmin defense-in-depth
- `styles/Admin.module.scss` — Minimal admin page shell styling
- `lib/AppContext.js` — Added 5-minute admin recheck useEffect for /admin/* routes
- `lib/auth.js` — Updated signToken to optionally embed email in JWT payload
- `pages/api/auth/login.js` — Pass user.email to signToken for edge middleware checks
- `components/layout/Sidebar.js` — Admin nav link with AdminIcon, visible only for user?.isAdmin
- `styles/Sidebar.module.scss` — navItemAdmin class with accent styling
- `pages/index.js` — adminAccess=required query flag handler + denial banner JSX
- `styles/Home.module.scss` — adminDeniedBanner and adminDeniedIcon styles

## Decisions Made

- **Web Crypto for edge JWT**: `jsonwebtoken` is not edge-runtime compatible. Implemented HS256 verification using `crypto.subtle` (globally available in Next.js middleware) — same algorithm, no new dependencies.
- **Email in JWT payload**: Admin identity requires comparing email against `ADMIN_EMAIL` env var. Embedding email in the httpOnly JWT cookie (never client-visible) avoids a database round-trip in middleware. Existing sessions need to re-login to get the new token; tokens without email fall back to non-admin (safe, fail-closed).
- **Defense-in-depth**: Middleware handles routing, `getServerSideProps` with `requireAdmin` adds server-side 403 enforcement so bypassing middleware still cannot grant admin page access.
- **router.replace vs router.push**: Used `router.replace` for admin denial redirects so the back button doesn't re-trigger the 403 path.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated signToken and login to embed email in JWT for edge middleware**
- **Found during:** Task 1 (middleware implementation)
- **Issue:** JWT contained only `userId`; the edge middleware had no way to compare user identity against `ADMIN_EMAIL` without a MongoDB round-trip (which is incompatible with the edge runtime). Non-admin redirect (`/?adminAccess=required`) from middleware was impossible without this.
- **Fix:** Updated `lib/auth.js` `signToken(userId, email)` to optionally embed email; updated `pages/api/auth/login.js` to pass `user.email`. Change is backward-compatible — existing tokens without email are treated as non-admin (fail-closed). Added clarifying comments.
- **Files modified:** `lib/auth.js`, `pages/api/auth/login.js`
- **Verification:** Build passes; middleware verification check passes
- **Committed in:** `31493f7` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - bug fix for edge runtime incompatibility)
**Impact on plan:** Required for middleware to enforce admin identity check at the edge without Node.js MongoDB access. No scope creep.

## Issues Encountered

- The Wave 1 commits (623a205, 3b44163) existed in git history but were on a different branch from the worktree. Cherry-picked both into the current worktree branch before proceeding — `lib/adminAccess.js`, `lib/requireAdmin.js`, and related files were not in the working tree until cherry-pick.

## User Setup Required

**Environment variables required before admin access works:**

Add both of the following to `.env.local`:

```
ADMIN_EMAIL=your-admin-email@example.com
JWT_SECRET=your-jwt-secret
```

**Note:** Existing login sessions (JWT cookies) created before this plan was deployed do NOT contain the `email` claim. Those sessions will be treated as non-admin by the middleware until the user logs out and logs back in. This is the correct fail-closed behavior.

## Next Phase Readiness

- Full admin access control layer is complete (API guard + page route guard + UX)
- `requireAdmin` is wired into the admin landing page via `getServerSideProps`
- Phase 1 requirements ADMIN-01 and ADMIN-02 are fully satisfied
- Phase 2 can build admin feature pages under `/admin/*` — they inherit the wildcard middleware guard automatically
- Admin navigation entry is present; future admin pages should add their own Sidebar links using the same `user?.isAdmin` conditional pattern

## Known Stubs

- `pages/admin/index.js` body contains placeholder text: "Artist expansion controls will appear here in the next phase." — this is intentional; Phase 2 will populate the admin dashboard with artist expansion controls. The access control guard (the goal of this plan) is fully wired.

## Self-Check: PASSED

- middleware.js: FOUND
- pages/admin/index.js: FOUND
- styles/Admin.module.scss: FOUND
- lib/AppContext.js (recheck loop): FOUND — contains `api/admin/access-check`, `5 * 60 * 1000`, `adminAccess=required`
- components/layout/Sidebar.js (isAdmin link): FOUND
- pages/index.js (Admin access required): FOUND
- styles/Home.module.scss (adminDeniedBanner): FOUND
- Build: PASSED (Next.js build output shows /admin as dynamic route, Middleware active)
- Task commits 31493f7, ab07e9e, 4515408: FOUND in git log

---
*Phase: 01-admin-access-control*
*Completed: 2026-04-14*
