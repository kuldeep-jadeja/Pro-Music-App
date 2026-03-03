import bcrypt from 'bcrypt';
import { serialize } from 'cookie';
import { connectDB } from '@/lib/mongodb';
import { withRateLimit } from '@/lib/rateLimit';
import { signToken } from '@/lib/auth';
import User from '@/models/User';

/**
 * POST /api/auth/login
 * Body: { email, password }
 *
 * Authenticates the user, signs a JWT, sets an HTTP-only cookie,
 * and returns the sanitised user object.
 */
async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { email, password } = req.body || {};

    // --- Input validation ---------------------------------------------------
    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required.' });
    }

    try {
        await connectDB();

        // Explicitly select passwordHash (may be excluded by a global projection
        // or toJSON transform — we need the raw value for bcrypt.compare).
        const user = await User.findOne({ email: email.trim().toLowerCase() })
            .select('+passwordHash')
            .lean();

        if (!user) {
            return res.status(401).json({ error: 'Invalid email or password.' });
        }

        const match = await bcrypt.compare(password, user.passwordHash);
        if (!match) {
            return res.status(401).json({ error: 'Invalid email or password.' });
        }

        // Sign token & set cookie
        const token = signToken(user._id.toString());

        res.setHeader(
            'Set-Cookie',
            serialize('token', token, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'lax',
                path: '/',
                maxAge: 60 * 60 * 24 * 7, // 7 days
            })
        );

        return res.status(200).json({
            user: { id: user._id, email: user.email },
        });
    } catch (err) {
        console.error('[login] error:', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}

// Rate limit: 10 login attempts per IP per minute
export default withRateLimit(handler, 10, 60_000);
