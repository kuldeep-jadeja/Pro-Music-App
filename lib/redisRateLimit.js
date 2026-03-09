/**
 * Redis-backed sliding-window rate limiter.
 *
 * Key format:  ratelimit:<ip>:<endpoint>
 * Strategy:    sorted-set where each member is a UUID and score is the
 *              request timestamp (ms).  On each request:
 *                1. Remove members older than (now - windowMs)
 *                2. Count remaining members
 *                3. If count < max, add current timestamp
 *
 * Falls back gracefully to { limited: false } when Redis is unavailable so
 * the caller can chain to the in-memory limiter.
 */

import { getRedis } from '@/lib/redis';

const isDev = process.env.NODE_ENV !== 'production';

/**
 * Sliding-window rate limit check backed by Redis.
 *
 * @param {string} ip  - Client IP address
 * @param {string} endpoint - Endpoint identifier (e.g. '/api/import-playlist')
 * @param {number} maxRequests - Max allowed requests per window
 * @param {number} windowMs   - Window size in milliseconds
 * @returns {Promise<{ available: boolean, limited: boolean, remaining: number, resetAt: number }>}
 *   `available` = false when Redis is unreachable (caller should use in-memory fallback)
 */
export async function redisRateLimit(ip, endpoint, maxRequests = 30, windowMs = 60_000) {
    const now = Date.now();
    const windowStart = now - windowMs;
    const resetAt = now + windowMs;
    const key = `ratelimit:${ip}:${endpoint}`;

    try {
        const redis = await getRedis();
        if (!redis) {
            return { available: false, limited: false, remaining: maxRequests, resetAt };
        }

        // Atomic pipeline: remove expired entries, count, conditionally add
        const pipeline = redis.pipeline();
        // Remove timestamps older than the window
        pipeline.zremrangebyscore(key, '-inf', windowStart);
        // Count requests still within the window
        pipeline.zcard(key);
        const results = await pipeline.exec();

        // Each element is [err, result]. Treat a command-level error as Redis
        // being unavailable so the caller falls back to the in-memory limiter.
        if (results[0][0] || results[1][0]) {
            const cmdErr = results[0][0] || results[1][0];
            if (isDev) console.error('[Redis] redisRateLimit pipeline error:', cmdErr.message);
            return { available: false, limited: false, remaining: maxRequests, resetAt };
        }

        const count = results[1][1];

        if (count >= maxRequests) {
            // Don't add new entry — still set TTL so key self-cleans
            await redis.expire(key, Math.ceil(windowMs / 1000) + 1);
            return {
                available: true,
                limited: true,
                remaining: 0,
                resetAt,
            };
        }

        // Add this request with timestamp as score; member is timestamp+random for uniqueness
        const member = `${now}-${Math.random().toString(36).slice(2)}`;
        const pipeline2 = redis.pipeline();
        pipeline2.zadd(key, now, member);
        pipeline2.expire(key, Math.ceil(windowMs / 1000) + 1);
        await pipeline2.exec();

        return {
            available: true,
            limited: false,
            remaining: maxRequests - (count + 1),
            resetAt,
        };
    } catch (err) {
        if (isDev) console.error('[Redis] redisRateLimit error:', err.message);
        return { available: false, limited: false, remaining: maxRequests, resetAt };
    }
}
