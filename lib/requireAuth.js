import { getUserFromRequest } from '@/lib/auth';

/**
 * Higher-order function that wraps an API handler with authentication.
 * If the request carries a valid JWT cookie, `req.user` is populated with
 * the lean user document and the inner handler is invoked.  Otherwise a
 * 401 Unauthorized response is returned immediately.
 *
 * Usage:
 *   export default requireAuth(async function handler(req, res) { ... });
 *
 * Can be composed with other wrappers (e.g. withRateLimit):
 *   export default withRateLimit(requireAuth(handler), 10, 60_000);
 *
 * @param {Function} handler - Next.js API route handler
 * @returns {Function} Wrapped handler
 */
export function requireAuth(handler) {
    return async (req, res) => {
        const user = await getUserFromRequest(req);

        if (!user) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        req.user = user;
        return handler(req, res);
    };
}
