/**
 * Simple in-memory rate limiter for API routes.
 * Tracks request counts per IP within a sliding window.
 */

const rateMap = new Map();

// ---------------------------------------------------------------------------
// PERIODIC CLEANUP — prevents unbounded memory growth from one-time visitors
// ---------------------------------------------------------------------------
// Without this, every unique IP that ever hits the server creates a permanent
// entry in rateMap.  Over weeks of uptime behind a CDN, hundreds of thousands
// of stale entries accumulate (~200 bytes each).  This sweep runs every 60s,
// removes expired entries, and enforces a hard cap of 50,000 entries as a
// safety net against pathological traffic patterns.
// ---------------------------------------------------------------------------
const MAX_RATE_MAP_SIZE = 50_000;

const cleanupInterval = setInterval(() => {
    const now = Date.now();

    // Pass 1: remove expired entries
    for (const [key, val] of rateMap) {
        if (now > val.resetAt) {
            rateMap.delete(key);
        }
    }

    // Pass 2: if still over cap, evict oldest entries by resetAt
    if (rateMap.size > MAX_RATE_MAP_SIZE) {
        const sorted = [...rateMap.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt);
        const toEvict = sorted.slice(0, rateMap.size - MAX_RATE_MAP_SIZE);
        for (const [key] of toEvict) {
            rateMap.delete(key);
        }
    }
}, 60_000);

// .unref() ensures this interval does not prevent Node.js from exiting
// when all other work is done (e.g., graceful shutdown, test runners).
cleanupInterval.unref();

/**
 * Check if a request should be rate-limited.
 * @param {string} key - Unique identifier (usually IP)
 * @param {number} maxRequests - Max allowed requests in the window
 * @param {number} windowMs - Time window in milliseconds
 * @returns {{ limited: boolean, remaining: number, resetAt: number }}
 */
export function rateLimit(key, maxRequests = 30, windowMs = 60000) {
    const now = Date.now();
    const record = rateMap.get(key);

    if (!record || now > record.resetAt) {
        rateMap.set(key, { count: 1, resetAt: now + windowMs });
        return { limited: false, remaining: maxRequests - 1, resetAt: now + windowMs };
    }

    record.count++;

    if (record.count > maxRequests) {
        return { limited: true, remaining: 0, resetAt: record.resetAt };
    }

    return { limited: false, remaining: maxRequests - record.count, resetAt: record.resetAt };
}

/**
 * Middleware wrapper for rate limiting API routes.
 */
export function withRateLimit(handler, maxRequests = 30, windowMs = 60000) {
    return async (req, res) => {
        const rawIp =
            req.headers['x-forwarded-for'] ||
            req.socket?.remoteAddress ||
            'unknown';
        const ip = rawIp.split(',')[0].trim();
        const { limited, remaining, resetAt } = rateLimit(ip, maxRequests, windowMs);

        res.setHeader('X-RateLimit-Remaining', remaining);
        res.setHeader('X-RateLimit-Reset', Math.ceil(resetAt / 1000));

        if (limited) {
            return res.status(429).json({
                error: 'Too many requests. Please try again later.',
                retryAfter: Math.ceil((resetAt - Date.now()) / 1000),
            });
        }

        return handler(req, res);
    };
}
