# Phase 1: Admin Access Control - Context

**Gathered:** 2026-04-14  
**Status:** Ready for planning

<domain>
## Phase Boundary

Restrict admin artist-expansion operations so only the configured admin identity can access and use protected admin surfaces. This phase covers access control behavior for admin pages/APIs only; queue actions and dashboard feature depth are handled in later phases.

</domain>

<decisions>
## Implementation Decisions

### Unauthorized UX behavior
- Signed-in non-admin users who open protected admin pages are redirected to home.
- After redirect, show a short message: **"Admin access required"**.
- Not-signed-in users who open protected admin pages are redirected to login.
- Admin navigation entry points are shown only for admin users.

### Session re-check behavior
- Admin authorization is enforced on every admin API call.
- Frontend page-level checks rely on server responses as the source of truth.
- If a user loses admin rights mid-session, next admin action must return 403 and redirect home with message.
- While admin page is open, run periodic admin-status recheck every 5 minutes, with immediate handling of API 403 whichever comes first.

### Surface coverage for this phase
- Protect **all `/admin/*` page routes** (future-ready wildcard policy).
- Protect **all `/api/admin/*` API routes**.
- Existing non-`/api/admin/*` endpoints stay unchanged in this phase.
- Admin action controls appear only inside protected `/admin/*` pages.

### Admin identity config policy
- Use `ADMIN_EMAIL` environment variable as the single admin identity source.
- Compare using normalized values: trim + lowercase on both configured/admin-session email values.
- If `ADMIN_EMAIL` is missing, deny all admin access and emit explicit server warning.
- Keep `ADMIN_EMAIL` server-only; do not expose to client bundle.

### Claude's Discretion
- Exact UI component for the "Admin access required" message (toast/banner implementation detail).
- Exact client recheck hook placement and naming, as long as 5-minute cadence + API-403-first behavior are preserved.

</decisions>

<specifics>
## Specific Ideas

- "All `/admin/*` should be protected now so future admin pages are covered by default."
- "Everything must stay in sync with existing workers; no bypass paths."

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase definition and scope
- `.planning/ROADMAP.md` — Phase 1 goal/success criteria and fixed boundary for Admin Access Control
- `.planning/REQUIREMENTS.md` — `ADMIN-01`, `ADMIN-02` requirements mapped to Phase 1
- `.planning/PROJECT.md` — core value, constraints, and prior decisions (single configured admin email)

### Existing auth/session patterns
- `lib/requireAuth.js` — standard API auth wrapper pattern (`req.user` population + 401 behavior)
- `pages/api/auth/me.js` — current session-check endpoint used by frontend
- `lib/auth.js` — JWT/cookie user resolution model used by auth wrappers

### Existing app shell and user state
- `pages/_app.js` — global provider/layout mount pattern for route-level behavior
- `lib/AppContext.js` — current user bootstrap flow via `/api/auth/me`
- `components/layout/Navbar.js` — user-aware navigation area where admin-only visibility decisions may integrate

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `requireAuth(handler)` in `lib/requireAuth.js` provides the existing server-side auth wrapper shape to compose into admin guard logic.
- `GET /api/auth/me` in `pages/api/auth/me.js` already supplies authenticated user identity to client-side bootstrapping.
- `AppContext` in `lib/AppContext.js` already centralizes current-user fetch and can host lightweight admin-state recheck orchestration.

### Established Patterns
- Protected APIs use wrapper composition (`requireAuth`, `withRateLimit`) rather than in-handler auth branching.
- Session is cookie/JWT-based and validated server-side.
- App shell uses default `AppLayout` via `pages/_app.js`, so route-level access behavior should align with this mount model.

### Integration Points
- New admin authorization wrapper should align with `requireAuth` usage for `/api/admin/*`.
- Admin page route gating should integrate with existing user/session bootstrap flow, then fallback to API 403 handling.
- Navbar or related layout navigation can conditionally render admin links based on authenticated admin status.

</code_context>

<deferred>
## Deferred Ideas

- Fine-grained role model (multi-admin/role-based policy) — future phase.
- Advanced admin dashboard capabilities (presets, queue health cards, impact preview) — mapped to later phases.

</deferred>

---

*Phase: 01-admin-access-control*  
*Context gathered: 2026-04-14*
