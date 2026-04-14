# Phase 01 Research: Admin Access Control

**Phase:** 1 - Admin Access Control  
**Date:** 2026-04-14  
**Status:** Complete

## Objective

Determine the safest and most codebase-aligned approach to implement `ADMIN-01` and `ADMIN-02`:
- Admin can access admin surfaces only if authenticated as configured admin email.
- Non-admin authenticated users receive forbidden behavior on admin APIs.

## Key Findings

### Existing reusable patterns

1. `lib/requireAuth.js` is the canonical API wrapper pattern that sets `req.user` and short-circuits unauthorized requests.
2. `pages/api/auth/me.js` is the existing frontend session bootstrap endpoint.
3. `lib/AppContext.js` already initializes user state from `/api/auth/me`, making it the natural place for admin-status recheck wiring.
4. `components/layout/Navbar.js` already renders user-aware controls and is suitable for admin-link conditional rendering.

### Recommended approach for Phase 1

1. Add `requireAdmin(handler)` wrapper composed on top of auth model:
   - Normalize both values via `trim().toLowerCase()`.
   - Compare `req.user.email` with `process.env.ADMIN_EMAIL`.
   - Return `403` for authenticated non-admins.
2. Protect all `/api/admin/*` routes with server-side admin guard.
3. Protect all `/admin/*` page routes with route-level checks:
   - unauthenticated -> redirect `/login`
   - authenticated non-admin -> redirect `/` with "Admin access required" message
4. Keep `ADMIN_EMAIL` server-only (no client exposure).
5. If `ADMIN_EMAIL` missing:
   - deny all admin access
   - emit explicit server warning log.

### Non-goals for this phase

- Multi-role or multi-admin RBAC model.
- Queue orchestration/dashboard behavior beyond access gates.
- Framework/router migrations.

## Risks and Mitigations

1. **Risk:** Client-only checks bypassed via direct API calls.  
   **Mitigation:** enforce admin authorization on every `/api/admin/*` handler.
2. **Risk:** Case/whitespace mismatch in email comparison.  
   **Mitigation:** strict normalization before compare.
3. **Risk:** Stale admin status in long session.  
   **Mitigation:** periodic 5-minute recheck + immediate API 403 handling.

## Validation Architecture

### Current verification baseline

- Project has no dedicated unit/integration test framework wired yet.
- Existing check command is `npm test` (mapped to production build).

### Planning implication

- Plans should include explicit verification steps per task.
- If deeper automated auth-route testing is needed, add Wave 0 validation tasks first.

## Sources

- `.planning/phases/01-admin-access-control/1-CONTEXT.md`
- `.planning/REQUIREMENTS.md`
- `.planning/STATE.md`
- `lib/requireAuth.js`
- `pages/api/auth/me.js`
- `lib/AppContext.js`
- `components/layout/Navbar.js`
- `README.md`
- `AGENT.md`
