import { NextResponse } from 'next/server';

/**
 * Next.js Edge Proxy — wildcard admin route protection
 *
 * Matcher: /admin/:path* — protects ALL current and future admin page routes.
 *
 * Auth strategy:
 *   - Read the `token` JWT cookie (httpOnly, signed at login with userId + email)
 *   - Verify signature using Web Crypto (HS256, edge-compatible)
 *   - Decode payload to check email claim against ADMIN_EMAIL env var
 *
 * Redirect policy:
 *   - No valid JWT / expired token -> /login
 *   - Valid JWT but email != ADMIN_EMAIL -> /?adminAccess=required
 *   - Valid JWT and email == ADMIN_EMAIL -> allow request to continue
 */

const JWT_SECRET = process.env.JWT_SECRET;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;

/**
 * Decode a base64url string to a Uint8Array.
 * @param {string} str
 * @returns {Uint8Array}
 */
function base64urlDecode(str) {
    const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    const binary = atob(padded);
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/**
 * Verify a HS256 JWT using Web Crypto (edge runtime compatible).
 * Returns the decoded payload on success, or null on failure.
 *
 * @param {string} token
 * @param {string} secret
 * @returns {Promise<object|null>}
 */
async function verifyJWT(token, secret) {
    try {
        const parts = token.split('.');
        if (parts.length !== 3) return null;

        const [headerB64, payloadB64, signatureB64] = parts;

        // Import the HMAC-SHA256 key
        const keyData = new TextEncoder().encode(secret);
        const key = await crypto.subtle.importKey(
            'raw',
            keyData,
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['verify']
        );

        // Verify the signature
        const signatureBytes = base64urlDecode(signatureB64);
        const messageData = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
        const valid = await crypto.subtle.verify('HMAC', key, signatureBytes, messageData);

        if (!valid) return null;

        // Decode the payload
        const payloadJson = new TextDecoder().decode(base64urlDecode(payloadB64));
        const payload = JSON.parse(payloadJson);

        // Check token expiry
        if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) return null;

        return payload;
    } catch {
        return null;
    }
}

/**
 * Normalize an email for comparison (mirrors lib/adminAccess.js server-side logic).
 * @param {string} email
 * @returns {string}
 */
function normalizeEmail(email) {
    if (typeof email !== 'string') return '';
    return email.trim().toLowerCase();
}

export async function proxy(request) {
    // Only runs for /admin/:path* routes (via matcher config below)
    const cookieToken = request.cookies.get('token')?.value;

    // No JWT cookie — user is not authenticated -> redirect to /login
    if (!cookieToken) {
        const loginUrl = new URL('/login', request.url);
        return NextResponse.redirect(loginUrl);
    }

    // Fail closed if JWT_SECRET is misconfigured
    if (!JWT_SECRET) {
        const loginUrl = new URL('/login', request.url);
        return NextResponse.redirect(loginUrl);
    }

    const payload = await verifyJWT(cookieToken, JWT_SECRET);

    // Invalid or expired JWT -> redirect to /login
    if (!payload) {
        const loginUrl = new URL('/login', request.url);
        return NextResponse.redirect(loginUrl);
    }

    // Valid JWT — check admin identity.
    // email is embedded in the token at login (httpOnly cookie, never client-visible).
    // If ADMIN_EMAIL is not configured, deny all admin access.
    const tokenEmail = payload.email;
    const isAdmin =
        ADMIN_EMAIL &&
        tokenEmail &&
        normalizeEmail(tokenEmail) === normalizeEmail(ADMIN_EMAIL);

    if (!isAdmin) {
        // Authenticated but not admin -> redirect to home with flag
        const homeUrl = new URL('/?adminAccess=required', request.url);
        return NextResponse.redirect(homeUrl);
    }

    // Authenticated admin — allow request through
    return NextResponse.next();
}

export const config = {
    matcher: ['/admin/:path*'],
};