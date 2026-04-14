import { connectDB } from '@/lib/mongodb';
import Track from '@/models/Track';
import { getRedis } from '@/lib/redis';

const CACHE_TTL_SECONDS = 6 * 60 * 60; // 6 hours
const isDev = process.env.NODE_ENV !== 'production';

function log(msg) {
    if (isDev) console.log(`[Redis] ${msg}`);
}

/**
 * GET /api/stream/[trackId]
 * Returns the YouTube video ID and embed-ready data for a given track.
 * The actual streaming happens via YouTube IFrame API on the frontend.
 *
 * Redis caching layer (TTL = 6 h):
 *   key: stream:track:<trackId>
 *   Redis is optional — falls back to MongoDB on any Redis failure.
 */
export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { trackId } = req.query;

    if (!trackId || typeof trackId !== 'string' || trackId.trim() === '') {
        return res.status(400).json({ error: 'Missing trackId' });
    }

    const cacheKey = `stream:track:${trackId}`;

    // ------------------------------------------------------------------
    // 1. Check Redis cache
    // ------------------------------------------------------------------
    // Fetch the client once and reuse it for both read and write so we never
    // create two concurrent getRedis() calls within the same request.
    let redis = null;
    try {
        redis = await getRedis();
        if (redis) {
            const cached = await redis.get(cacheKey);
            if (cached) {
                log(`Redis cache hit — ${cacheKey}`);
                res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400');
                res.setHeader('X-Cache', 'HIT');
                return res.status(200).json(JSON.parse(cached));
            }
            log(`Redis cache miss — ${cacheKey}`);
        }
    } catch (redisErr) {
        // Redis failure must never crash the request — fall through to MongoDB
        if (isDev) console.error('[Redis] cache read error:', redisErr.message);
        redis = null;
    }

    // ------------------------------------------------------------------
    // 2. MongoDB fallback / source of truth
    // ------------------------------------------------------------------
    try {
        await connectDB();

        const track = await Track.findById(trackId).lean();

        if (!track) {
            return res.status(404).json({ error: 'Track not found' });
        }

        if (!track.youtubeVideoId) {
            return res.status(404).json({
                error: 'No YouTube match available for this track',
                track: { name: track.name, artists: track.artists },
            });
        }

        const payload = {
            trackId: track._id,
            name: track.name,
            artists: track.artists,
            youtubeVideoId: track.youtubeVideoId,
            embedUrl: `https://www.youtube.com/embed/${track.youtubeVideoId}?autoplay=1&enablejsapi=1`,
        };

        // ------------------------------------------------------------------
        // 3. Populate Redis cache (best-effort — errors are silently ignored)
        // Reuse the client reference acquired above; no second getRedis() call.
        // ------------------------------------------------------------------
        try {
            if (redis) {
                await redis.set(cacheKey, JSON.stringify(payload), 'EX', CACHE_TTL_SECONDS);
            }
        } catch (redisErr) {
            if (isDev) console.error('[Redis] cache write error:', redisErr.message);
        }

        res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400');
        res.setHeader('X-Cache', 'MISS');

        return res.status(200).json(payload);
    } catch (err) {
        console.error('Stream error:', err);
        return res.status(500).json({ error: 'Failed to get stream data' });
    }
}
