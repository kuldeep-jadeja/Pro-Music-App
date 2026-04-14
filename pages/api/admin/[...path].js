import { requireAdmin } from '@/lib/requireAdmin';

/**
 * Catch-all fallback for /api/admin/* routes.
 *
 * Ensures that any request to an unknown admin API endpoint is protected by
 * the admin guard before receiving a 404 response. This prevents unauthorized
 * callers from probing admin API surface for undiscovered endpoints.
 *
 * Authorization is fully handled by the requireAdmin wrapper:
 * - 401 Unauthorized — not authenticated
 * - 403 Forbidden    — authenticated but not the configured admin
 * - 404 Not Found    — authenticated admin hitting an unrecognized path
 */
async function handler(req, res) {
    return res.status(404).json({ error: 'Not found' });
}

export default requireAdmin(handler);
