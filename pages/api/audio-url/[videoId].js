import { Innertube } from 'youtubei.js';
import { getRedis } from '@/lib/redis';

const isDev = process.env.NODE_ENV !== 'production';

// Cache audio URLs for 2 hours (YouTube URLs typically expire in ~6h)
const CACHE_TTL_SECONDS = 2 * 60 * 60;

// Singleton Innertube instance — reused across requests
let innertubeInstance = null;

async function getInnertube() {
    if (!innertubeInstance) {
        innertubeInstance = await Innertube.create({
            cache: undefined,
            generate_session_locally: true,
        });
    }
    return innertubeInstance;
}

/**
 * GET /api/audio-url/[videoId]
 *
 * Extracts a direct audio stream URL from YouTube using youtubei.js.
 * Returns { url, mimeType, duration } on success.
 *
 * The audio URL is a direct link to the audio stream that can be
 * loaded into a native HTML5 <audio> element for background-safe playback.
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

    const cacheKey = `audio-url:${videoId}`;

    // ── 1. Check Redis cache ──────────────────────────────────────────
    let redis = null;
    try {
        redis = await getRedis();
        if (redis) {
            const cached = await redis.get(cacheKey);
            if (cached) {
                if (isDev) console.log(`[AudioURL] Cache HIT — ${videoId}`);
                res.setHeader('Cache-Control', 'public, max-age=3600');
                res.setHeader('X-Cache', 'HIT');
                return res.status(200).json(JSON.parse(cached));
            }
        }
    } catch (err) {
        if (isDev) console.error('[AudioURL] Redis read error:', err.message);
        redis = null;
    }

    // ── 2. Extract audio URL via youtubei.js ──────────────────────────
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
        // Prefer: audio/webm (opus) > audio/mp4 (aac) for quality/size
        let audioFormat = null;

        // First, try audio/mp4 (broader browser compatibility, especially iOS)
        audioFormat = formats
            .filter(f => f.mime_type?.startsWith('audio/mp4'))
            .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];

        // Fallback to audio/webm
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

        // The decipher method gives us the direct URL
        const url = audioFormat.decipher(yt.session.player);

        if (!url) {
            return res.status(404).json({ error: 'Could not extract audio URL' });
        }

        const payload = {
            url,
            mimeType: audioFormat.mime_type || 'audio/mp4',
            bitrate: audioFormat.bitrate || 0,
            duration: audioFormat.approx_duration_ms
                ? Math.round(audioFormat.approx_duration_ms / 1000)
                : null,
        };

        // ── 3. Cache in Redis ─────────────────────────────────────────
        try {
            if (redis) {
                await redis.set(cacheKey, JSON.stringify(payload), 'EX', CACHE_TTL_SECONDS);
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
        innertubeInstance = null;

        return res.status(500).json({
            error: 'Failed to extract audio URL',
            fallback: true,
        });
    }
}
