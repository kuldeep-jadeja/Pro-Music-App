import { Innertube } from 'youtubei.js';
import { getRedis } from '@/lib/redis';
import { connectDB } from '@/lib/mongodb';
import Track from '@/models/Track';
import { findYouTubeMatch } from '@/lib/youtubeMatcher';

const isDev = process.env.NODE_ENV !== 'production';
const CACHE_TTL_SECONDS  = 2 * 60 * 60;       // 2h  — Redis eviction TTL
const URL_EXPIRY_MS      = 6 * 60 * 60 * 1000; // 6h  — CDN URL lifetime

let innertubePromise = null;

async function getInnertube() {
    if (!innertubePromise) {
        innertubePromise = Innertube.create({
            cache: undefined,
            generate_session_locally: true,
        }).catch(err => {
            innertubePromise = null;
            throw err;
        });
    }
    return innertubePromise;
}

/**
 * GET /api/stream/audio
 * Query: ?videoId=... OR ?trackId=...
 *
 * Extracts the direct audio stream URL and performs a 302 Redirect to it.
 * This is CRITICAL for iOS background audio: it allows the client to set
 * `audio.src = '/api/stream/audio?videoId=...'` synchronously inside a user
 * gesture, so iOS considers it a real stream. The connection is held open
 * while we extract the YouTube CDN URL, and then we redirect the native player.
 */
export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    let { videoId, trackId } = req.query;

    if (!videoId && !trackId) {
        return res.status(400).json({ error: 'Missing videoId or trackId' });
    }

    try {
        // ── 1. Resolve videoId from trackId if necessary ─────────────
        if (!videoId && trackId) {
            await connectDB();
            const track = await Track.findById(trackId);
            if (!track) return res.status(404).json({ error: 'Track not found' });

            if (track.youtubeVideoId) {
                videoId = track.youtubeVideoId;
            } else {
                // We need to match it synchronously
                const matchedId = await findYouTubeMatch(track.name, track.artists?.[0] || 'Unknown', track.duration_ms);
                if (!matchedId) return res.status(404).json({ error: 'No YouTube match found' });

                track.youtubeVideoId = matchedId;
                await track.save();
                videoId = matchedId;
            }
        }

        const cacheKey = `demus:audio-url:${videoId}`;

        // ── 2. Check Redis cache ───────────────────────────────────────
        let redis = null;
        try {
            redis = await getRedis();
            if (redis) {
                const cached = await redis.get(cacheKey);
                if (cached) {
                    const parsed = JSON.parse(cached);
                    if (parsed.expiresAt && Date.now() < parsed.expiresAt) {
                        if (isDev) console.log(`[StreamProxy] Cache HIT — ${videoId}`);
                        res.setHeader('Cache-Control', 'public, max-age=3600');
                        res.setHeader('X-Cache', 'HIT');
                        return res.redirect(302, parsed.audioUrl);
                    }
                    try { await redis.del(cacheKey); } catch { }
                }
            }
        } catch (err) {
            if (isDev) console.error('[StreamProxy] Redis read error:', err.message);
            redis = null;
        }

        // ── 3. Extract audio URL via youtubei.js ───────────────────────
        const lockKey = `demus:audio-lock:${videoId}`;
        const LOCK_TTL = 15;
        let acquiredLock = false;

        if (redis) {
            try {
                const lockResult = await redis.set(lockKey, '1', 'EX', LOCK_TTL, 'NX');
                acquiredLock = lockResult === 'OK';
            } catch { }
        }

        if (!acquiredLock && redis) {
            for (let i = 0; i < 12; i++) {
                await new Promise(r => setTimeout(r, 1000));
                try {
                    const waiting = await redis.get(cacheKey);
                    if (waiting) {
                        const parsed = JSON.parse(waiting);
                        if (parsed.expiresAt && Date.now() < parsed.expiresAt) {
                            res.setHeader('X-Cache', 'HIT-LOCK-WAIT');
                            return res.redirect(302, parsed.audioUrl);
                        }
                    }
                } catch { break; }
            }
        }

        const yt = await getInnertube();
        const info = await yt.getBasicInfo(videoId);
        const streamingData = info.streaming_data;

        if (!streamingData) {
            return res.status(404).json({ error: 'No streaming data available' });
        }

        const formats = streamingData.adaptive_formats || [];
        const PREFERRED_MP4_ITAGS = [141, 140];

        let audioFormat = formats
            .filter(f => f.mime_type?.startsWith('audio/mp4'))
            .sort((a, b) => {
                const aRank = PREFERRED_MP4_ITAGS.indexOf(a.itag);
                const bRank = PREFERRED_MP4_ITAGS.indexOf(b.itag);
                if (aRank !== -1 || bRank !== -1) {
                    const aScore = aRank === -1 ? 999 : aRank;
                    const bScore = bRank === -1 ? 999 : bRank;
                    return aScore - bScore;
                }
                return (b.bitrate || 0) - (a.bitrate || 0);
            })[0];

        if (!audioFormat) {
            audioFormat = formats
                .filter(f => f.mime_type?.startsWith('audio/webm'))
                .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
        }

        if (!audioFormat) {
            audioFormat = formats
                .filter(f => f.mime_type?.startsWith('audio/'))
                .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
        }

        if (!audioFormat) {
            return res.status(404).json({ error: 'No audio format available' });
        }

        const audioUrl = audioFormat.decipher(yt.session.player);

        if (!audioUrl) {
            return res.status(404).json({ error: 'Could not extract audio URL' });
        }

        const expiresAt = Date.now() + URL_EXPIRY_MS;
        const payload = { audioUrl, expiresAt };

        try {
            if (redis) {
                await redis.set(cacheKey, JSON.stringify(payload), 'EX', CACHE_TTL_SECONDS);
                if (acquiredLock) {
                    await redis.del(lockKey).catch(() => {});
                }
            }
        } catch (err) {
            if (isDev) console.error('[StreamProxy] Redis write error:', err.message);
        }

        if (isDev) console.log(`[StreamProxy] Redirecting ${videoId} to CDN`);

        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.setHeader('X-Cache', 'MISS');
        return res.redirect(302, audioUrl);

    } catch (err) {
        console.error(`[StreamProxy] Error for videoId ${videoId}:`, err.message);
        innertubePromise = null;
        return res.status(500).json({ error: 'Failed to extract audio URL' });
    }
}