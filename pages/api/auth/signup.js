import bcrypt from 'bcrypt';
import { serialize } from 'cookie';
import { connectDB } from '@/lib/mongodb';
import { withRateLimit } from '@/lib/rateLimit';
import { signToken } from '@/lib/auth';
import User from '@/models/User';

const SALT_ROUNDS = 12;

/**
 * POST /api/auth/signup
 * Body: { email, password }
 *
 * Creates a new user account, signs a JWT, sets an HTTP-only cookie,
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

    const trimmedEmail = email.trim().toLowerCase();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
        return res.status(400).json({ error: 'Invalid email address.' });
    }

    if (password.length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }

    try {
        await connectDB();

        // Check for existing user
        const existing = await User.findOne({ email: trimmedEmail }).lean();
        if (existing) {
            return res.status(409).json({ error: 'An account with this email already exists.' });
        }

        // Hash & create
        const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
        const user = await User.create({ email: trimmedEmail, passwordHash });

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

        return res.status(201).json({
            user: { id: user._id, email: user.email },
        });
    } catch (err) {
        // Handle duplicate key race condition (concurrent signup with same email)
        if (err.code === 11000) {
            return res.status(409).json({ error: 'An account with this email already exists.' });
        }
        console.error('[signup] error:', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}

// Rate limit: 5 signup attempts per IP per minute
export default withRateLimit(handler, 5, 60_000);
