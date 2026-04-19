import jwt from 'jsonwebtoken';
import { parse } from 'cookie';
import { connectDB } from '@/lib/mongodb';
import User from '@/models/User';

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
    throw new Error('Please define JWT_SECRET in .env.local');
}

/**
 * Sign a JWT for the given user ID.
 * Optionally include email in the payload so edge proxy can perform
 * admin identity checks without a database round-trip.
 *
 * @param {string} userId - Mongoose ObjectId as string
 * @param {string} [email] - User email to embed in token (server-only; not
 *   exposed to the client — the token is httpOnly)
 * @returns {string} Signed JWT token
 */
export function signToken(userId, email) {
    const payload = { userId };
    if (email) payload.email = email.trim().toLowerCase();
    return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}

/**
 * Verify and decode a JWT.
 * @param {string} token
 * @returns {{ userId: string } | null} Decoded payload or null on failure
 */
export function verifyToken(token) {
    try {
        return jwt.verify(token, JWT_SECRET);
    } catch {
        return null;
    }
}

/**
 * Extract the authenticated user from an incoming request.
 * Reads the `token` cookie, verifies the JWT, and fetches the user from MongoDB.
 *
 * @param {import('next').NextApiRequest} req
 * @returns {Promise<object|null>} Lean user document (without passwordHash) or null
 */
export async function getUserFromRequest(req) {
    const cookieHeader = req.headers.cookie;
    if (!cookieHeader) return null;

    const cookies = parse(cookieHeader);
    const token = cookies.token;
    if (!token) return null;

    const decoded = verifyToken(token);
    if (!decoded?.userId) return null;

    await connectDB();

    const user = await User.findById(decoded.userId)
        .select('-passwordHash')
        .lean();

    return user || null;
}
