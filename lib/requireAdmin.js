import { requireAuth } from '@/lib/requireAuth';
import { isAdminEmail } from '@/lib/adminAccess';

/**
 * Higher-order function that wraps an API handler with admin-only authorization.
 *
 * Composes requireAuth (JWT/session validation) with an additional admin email
 * check. The authentication and user resolution logic is NOT duplicated here —
 * requireAuth handles that and populates req.user.
 *
 * Response behavior:
 * - 401 Unauthorized  — not authenticated (handled by requireAuth)
 * - 403 Forbidden     — authenticated but not the configured admin
 * - Passes through    — authenticated admin, calls the wrapped handler
 *
 * Usage:
 *   export default requireAdmin(async function handler(req, res) { ... });
 *
 * Can be composed with other wrappers (same pattern as requireAuth):
 *   export default withRateLimit(requireAdmin(handler), 10, 60_000);
 *
 * @param {Function} handler - Next.js API route handler
 * @returns {Function} Wrapped handler with admin enforcement
 */
export function requireAdmin(handler) {
    return requireAuth(async (req, res) => {
        if (!isAdminEmail(req.user?.email)) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        return handler(req, res);
    });
}
