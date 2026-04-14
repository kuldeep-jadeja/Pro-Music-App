import { requireAdmin } from '@/lib/requireAdmin';

/**
 * GET /api/admin/access-check
 *
 * Admin-only probe endpoint used for runtime authorization verification.
 * Returns a lightweight success payload when the request comes from the
 * configured admin identity.
 *
 * Authorization is fully handled by the requireAdmin wrapper:
 * - 401 Unauthorized — not authenticated
 * - 403 Forbidden    — authenticated but not the configured admin
 * - 200 OK           — authenticated admin
 */
async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    return res.status(200).json({ ok: true, admin: req.user.email });
}

export default requireAdmin(handler);
