import { serialize } from 'cookie';

/**
 * POST /api/auth/logout
 *
 * Clears the auth cookie by setting it to an empty value with maxAge -1.
 */
export default function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    res.setHeader(
        'Set-Cookie',
        serialize('token', '', {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            path: '/',
            maxAge: -1,
        })
    );

    return res.status(200).json({ ok: true });
}
