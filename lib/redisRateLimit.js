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
const RATE_LIMIT_LUA = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local windowStart = tonumber(ARGV[2])
local maxRequests = tonumber(ARGV[3])
local ttlSeconds = tonumber(ARGV[4])
local member = ARGV[5]

redis.call('ZREMRANGEBYSCORE', key, '-inf', windowStart)
local count = redis.call('ZCARD', key)

if count >= maxRequests then
  redis.call('EXPIRE', key, ttlSeconds)
  return {1, count}
end

redis.call('ZADD', key, now, member)
redis.call('EXPIRE', key, ttlSeconds)
return {0, count + 1}
`;

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
    const ttlSeconds = Math.ceil(windowMs / 1000) + 1;
    const key = `ratelimit:${ip}:${endpoint}`;

    try {
        const redis = await getRedis();
        if (!redis) {
            return { available: false, limited: false, remaining: maxRequests, resetAt };
        }

        const member = `${now}-${Math.random().toString(36).slice(2)}`;
        const [limitedRaw, countRaw] = await redis.eval(
            RATE_LIMIT_LUA,
            1,
            key,
            now,
            windowStart,
            maxRequests,
            ttlSeconds,
            member
        );
        const limited = Number(limitedRaw) === 1;
        const count = Number(countRaw);

        if (limited) {
            return {
                available: true,
                limited: true,
                remaining: 0,
                resetAt,
            };
        }

        return {
            available: true,
            limited: false,
            remaining: Math.max(0, maxRequests - count),
            resetAt,
        };
    } catch (err) {
        if (isDev) console.error('[Redis] redisRateLimit error:', err.message);
        return { available: false, limited: false, remaining: maxRequests, resetAt };
    }
}
