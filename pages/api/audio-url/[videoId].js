import { Innertube } from 'youtubei.js';
import { getRedis } from '@/lib/redis';

const isDev = process.env.NODE_ENV !== 'production';

// Cache audio URLs for 2h (well within the ~6h CDN URL lifetime)
// YouTube CDN URLs are valid for ~6h. We cache for 2h (well within that window)
// so Redis evicts stale entries before the CDN URL can expire.
const CACHE_TTL_SECONDS  = 2 * 60 * 60;       // 2h  — Redis eviction TTL
const URL_EXPIRY_MS      = 6 * 60 * 60 * 1000; // 6h  — CDN URL lifetime (embedded in payload)

// Singleton Innertube instance — reused across requests
let innertubePromise = null;

async function getInnertube() {
    if (!innertubePromise) {
        innertubePromise = Innertube.create({
            cache: undefined,
            generate_session_locally: true,
        }).catch(err => {
            innertubePromise = null; // allow retry on next call
            throw err;
        });
    }
    return innertubePromise;
}

/**
 * GET /api/audio-url/[videoId]
 *
 * Extracts a direct audio stream URL from YouTube using youtubei.js.
 * Returns { audioUrl, expiresAt } on success.
 *
 * The server does NOT proxy audio bytes — it only extracts and returns
 * the direct YouTube CDN audio URL. The client loads this URL directly
 * into an HTML5 <audio> element.
 *
 * Redis caching layer (TTL = 2h):
 *   key: audio-url:<videoId>
 */
export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { videoId } = req.query;

    if (!videoId || typeof videoId !== 'string' || videoId.trim() === '') {
        return res.status(400).json({ error: 'Missing videoId' });
    }

    const cacheKey = `demus:audio-url:${videoId}`;

    // ── 1. Check Redis cache ──────────────────────────────────────────
    let redis = null;
    try {
        redis = await getRedis();
        if (redis) {
            const cached = await redis.get(cacheKey);
            if (cached) {
                const parsed = JSON.parse(cached);
                // Check if the cached URL has expired
                if (parsed.expiresAt && Date.now() < parsed.expiresAt) {
                    if (isDev) console.log(`[AudioURL] Cache HIT — ${videoId}`);
                    res.setHeader('Cache-Control', 'public, max-age=3600');
                    res.setHeader('X-Cache', 'HIT');
                    return res.status(200).json(parsed);
                }
                // Expired — delete stale cache entry
                try { await redis.del(cacheKey); } catch { }
            }
        }
    } catch (err) {
        if (isDev) console.error('[AudioURL] Redis read error:', err.message);
        redis = null;
    }

    // ── 2. Extract audio URL via youtubei.js ──────────────────────────
    // ── 2a. Acquire extraction lock (prevents thundering herd) ────────
    const lockKey = `demus:audio-lock:${videoId}`;
    const LOCK_TTL = 15; // seconds — extraction must complete within 15s
    let acquiredLock = false;

    if (redis) {
        try {
            const lockResult = await redis.set(lockKey, '1', 'EX', LOCK_TTL, 'NX');
            acquiredLock = lockResult === 'OK';
        } catch { /* proceed without lock on Redis error */ }
    }

    // Another request is already extracting — poll for the cached result
    if (!acquiredLock && redis) {
        for (let i = 0; i < 12; i++) {
            await new Promise(r => setTimeout(r, 1000));
            try {
                const waiting = await redis.get(cacheKey);
                if (waiting) {
                    const parsed = JSON.parse(waiting);
                    if (parsed.expiresAt && Date.now() < parsed.expiresAt) {
                        res.setHeader('X-Cache', 'HIT-LOCK-WAIT');
                        return res.status(200).json(parsed);
                    }
                }
            } catch { break; }
        }
        // Timed out waiting — fall through and extract anyway
    }

    try {
        const yt = await getInnertube();
        const info = await yt.getBasicInfo(videoId);

        // Get the streaming data
        const streamingData = info.streaming_data;

        if (!streamingData) {
            if (isDev) console.warn(`[AudioURL] No streaming data for ${videoId}`);
            return res.status(404).json({ error: 'No streaming data available' });
        }

        // Prefer adaptive formats (audio-only streams)
        const formats = streamingData.adaptive_formats || [];

        // Find the best audio-only format
        // Prefer audio/mp4 (AAC) for broadest browser compatibility (iOS Safari)
        let audioFormat = null;

        // Preferred AAC itags by quality (140=128kbps, 141=256kbps, 233/234=HLS)
        const PREFERRED_MP4_ITAGS = [141, 140];

        // First: audio/mp4 (AAC — works on all browsers including iOS)
        audioFormat = formats
            .filter(f => f.mime_type?.startsWith('audio/mp4'))
            .sort((a, b) => {
                const aRank = PREFERRED_MP4_ITAGS.indexOf(a.itag);
                const bRank = PREFERRED_MP4_ITAGS.indexOf(b.itag);
                // Prefer known itags first; among unknowns fall back to bitrate
                if (aRank !== -1 || bRank !== -1) {
                    const aScore = aRank === -1 ? 999 : aRank;
                    const bScore = bRank === -1 ? 999 : bRank;
                    return aScore - bScore;
                }
                return (b.bitrate || 0) - (a.bitrate || 0);
            })[0];

        // Second: audio/webm (Opus — better quality, works on most)
        if (!audioFormat) {
            audioFormat = formats
                .filter(f => f.mime_type?.startsWith('audio/webm'))
                .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
        }

        // Last resort: any audio format
        if (!audioFormat) {
            audioFormat = formats
                .filter(f => f.mime_type?.startsWith('audio/'))
                .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
        }

        if (!audioFormat) {
            if (isDev) console.warn(`[AudioURL] No audio format found for ${videoId}`);
            return res.status(404).json({ error: 'No audio format available' });
        }

        // The decipher method gives us the direct CDN URL
        const audioUrl = audioFormat.decipher(yt.session.player);

        if (!audioUrl) {
            return res.status(404).json({ error: 'Could not extract audio URL' });
        }

        // expiresAt reflects the actual CDN URL lifetime so clients can
        // proactively re-fetch before the URL becomes invalid.
        const expiresAt = Date.now() + URL_EXPIRY_MS;

        const payload = {
            audioUrl,
            expiresAt,
        };

        // ── 3. Cache in Redis ─────────────────────────────────────────
        try {
            if (redis) {
                await redis.set(cacheKey, JSON.stringify(payload), 'EX', CACHE_TTL_SECONDS);
                if (acquiredLock) {
                    await redis.del(lockKey).catch(() => {});
                }
            }
        } catch (err) {
            if (isDev) console.error('[AudioURL] Redis write error:', err.message);
        }

        if (isDev) console.log(`[AudioURL] Extracted audio URL for ${videoId} (${audioFormat.mime_type})`);

        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.setHeader('X-Cache', 'MISS');
        return res.status(200).json(payload);

    } catch (err) {
        console.error(`[AudioURL] Extraction failed for ${videoId}:`, err.message);

        // Reset the Innertube instance on failure so it's recreated next time
        innertubePromise = null;

        if (redis && acquiredLock) {
            try { await redis.del(lockKey); } catch { }
        }

        return res.status(500).json({
            error: 'Failed to extract audio URL',
            fallback: true,
        });
    }
}
