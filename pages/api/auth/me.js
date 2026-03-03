import { getUserFromRequest } from '@/lib/auth';
import { connectDB } from '@/lib/mongodb';

/**
 * GET /api/auth/me
 *
 * Returns the currently authenticated user or 401.
 * Used by the frontend to check session status on page load.
 */
export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        await connectDB();

        const user = await getUserFromRequest(req);

        if (!user) {
            return res.status(401).json({ error: 'Not authenticated' });
        }

        return res.status(200).json({
            user: { id: user._id, email: user.email },
        });
    } catch (err) {
        console.error('[auth/me] error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
}
