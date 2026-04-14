// import { Innertube } from 'youtubei.js';
// import { getRedis } from '@/lib/redis';

// const CACHE_TTL_SECONDS = 2 * 60 * 60; // 2 hours (YouTube URLs expire ~6h, cache for 2h to be safe)
// const isDev = process.env.NODE_ENV !== 'production';

// function log(msg) {
//     if (isDev) console.log(`[audio-url] ${msg}`);
// }

// /**
//  * GET /api/audio-url/[videoId]
//  * 
//  * Extracts the direct audio stream URL from YouTube using youtubei.js with ANDROID client.
//  * Returns the CDN URL that mobile clients can stream directly.
//  * 
//  * Redis caching layer (TTL = 2h):
//  *   key: demus:audio-url:<videoId>
//  *   
//  * CRITICAL: YouTube URLs expire after ~6 hours. Mobile clients MUST check
//  * expiresAt before playback and refetch if expired.
//  */
// export default async function handler(req, res) {
//     if (req.method !== 'GET') {
//         return res.status(405).json({ error: 'Method not allowed' });
//     }

//     const { videoId } = req.query;

//     if (!videoId || typeof videoId !== 'string' || videoId.trim() === '') {
//         return res.status(400).json({ error: 'Missing or invalid videoId' });
//     }

//     const cacheKey = `demus:audio-url:${videoId}`;

//     // ------------------------------------------------------------------
//     // 1. Check Redis cache first
//     // ------------------------------------------------------------------
//     let redis = null;
//     try {
//         redis = await getRedis();
//         if (redis) {
//             const cached = await redis.get(cacheKey);
//             if (cached) {
//                 const data = JSON.parse(cached);

//                 // Check if cached URL is still valid (not expired)
//                 if (data.expiresAt && data.expiresAt > Date.now()) {
//                     log(`Redis cache HIT for ${videoId} (expires in ${Math.round((data.expiresAt - Date.now()) / 1000 / 60)}m)`);
//                     res.setHeader('X-Cache', 'HIT');
//                     return res.status(200).json(data);
//                 } else {
//                     log(`Redis cache EXPIRED for ${videoId} - will re-extract`);
//                     // Delete expired cache
//                     await redis.del(cacheKey);
//                 }
//             } else {
//                 log(`Redis cache MISS for ${videoId}`);
//             }
//         }
//     } catch (redisErr) {
//         if (isDev) console.error('[audio-url] Redis read error:', redisErr.message);
//         redis = null;
//     }

//     // ------------------------------------------------------------------
//     // 2. Extract audio URL using ytdl-core
//     // ------------------------------------------------------------------
//     try {
//         log(`Extracting audio URL for ${videoId}...`);

//         // Get video info with options to bypass bot detection
//         const info = await ytdl.getInfo(videoId, {
//             requestOptions: {
//                 headers: {
//                     'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
//                 }
//             }
//         });

//         // Filter for audio-only formats
//         const audioFormats = ytdl.filterFormats(info.formats, 'audioonly');

//         if (audioFormats.length === 0) {
//             log(`No audio formats available for ${videoId}`);
//             return res.status(500).json({
//                 error: 'No audio formats available',
//                 videoId,
//             });
//         }

//         // Choose best audio quality
//         const bestAudio = ytdl.chooseFormat(audioFormats, { quality: 'highestaudio' });

//         if (!bestAudio || !bestAudio.url) {
//             log(`No audio URL found for ${videoId}`);
//             return res.status(500).json({
//                 error: 'Failed to extract audio URL',
//                 videoId,
//             });
//         }

//         const audioUrl = bestAudio.url;
//         log(`✅ Extracted audio URL for ${videoId} (${bestAudio.mimeType}, ${Math.round(bestAudio.bitrate / 1000)}kbps)`);

//         // YouTube URLs expire after ~6 hours
//         // Set our expiry to 2 hours to be conservative
//         const expiresAt = Date.now() + (2 * 60 * 60 * 1000);

//         const payload = {
//             audioUrl: audioUrl,
//             expiresAt,
//             videoId,
//             format: bestAudio.mimeType?.split(';')[0] || 'audio/webm',
//             bitrate: bestAudio.bitrate || 0,
//             contentLength: parseInt(bestAudio.contentLength) || 0,
//         };

//         // ------------------------------------------------------------------
//         // 3. Cache in Redis (best-effort)
//         // ------------------------------------------------------------------
//         try {
//             if (redis) {
//                 await redis.set(
//                     cacheKey,
//                     JSON.stringify(payload),
//                     'EX',
//                     CACHE_TTL_SECONDS
//                 );
//                 log(`Cached audio URL for ${videoId} (TTL: ${CACHE_TTL_SECONDS}s)`);
//             }
//         } catch (redisErr) {
//             if (isDev) console.error('[audio-url] Redis write error:', redisErr.message);
//         }

//         res.setHeader('X-Cache', 'MISS');
//         return res.status(200).json(payload);

//     } catch (err) {
//         console.error(`[audio-url] Extraction failed for ${videoId}:`, err);

//         // Handle specific YouTube errors
//         if (err.message?.includes('Video unavailable')) {
//             return res.status(404).json({
//                 error: 'Video unavailable or private',
//                 videoId,
//             });
//         }

//         if (err.message?.includes('age-restricted')) {
//             return res.status(403).json({
//                 error: 'Video is age-restricted',
//                 videoId,
//             });
//         }

//         return res.status(500).json({
//             error: 'Failed to extract audio URL',
//             message: isDev ? err.message : 'Internal server error',
//             videoId,
//         });
//     }
// }


import { Innertube, UniversalCache } from 'youtubei.js';
import { getRedis } from '@/lib/redis';

// ─── Config ───────────────────────────────────────────────
const CACHE_TTL_SECONDS = 2 * 60 * 60; // 2 hours
const isDev = process.env.NODE_ENV !== 'production';
const VIDEO_ID_REGEX = /^[a-zA-Z0-9_-]{11}$/;

// Preferred itag order: 251 (Opus 160k), 250 (Opus 70k), 249 (Opus 50k), 140 (AAC 128k)
const PREFERRED_ITAGS = [251, 250, 249, 140];

// ─── Singleton Innertube Instance ─────────────────────────
// Innertube.create() is expensive (fetches player JS, parses
// decipher algorithms). We reuse a single instance across
// all requests and only recreate on decipher failure.
let innertubeInstance = null;
let innertubeCreatedAt = 0;
const INNERTUBE_MAX_AGE_MS = 30 * 60 * 1000; // recreate every 30 min

// ─── Rate Limiting Protection ─────────────────────────────
// Prevent YouTube from detecting burst patterns
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL_MS = 1000; // Minimum 1 second between requests
const requestQueue = [];
let isProcessingQueue = false;

// Exponential backoff for rate limit errors
let backoffDelay = 0;
const MAX_BACKOFF_DELAY = 30000; // Max 30 seconds

async function waitForRateLimit() {
    const now = Date.now();
    const timeSinceLastRequest = now - lastRequestTime;
    
    // Add backoff delay if we're being rate limited
    const requiredDelay = Math.max(MIN_REQUEST_INTERVAL_MS, backoffDelay);
    
    if (timeSinceLastRequest < requiredDelay) {
        const waitTime = requiredDelay - timeSinceLastRequest;
        log(`⏱️ Rate limiting: waiting ${waitTime}ms before next request`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    lastRequestTime = Date.now();
}

async function getInnertube(forceRefresh = false) {
    const now = Date.now();
    const isStale = now - innertubeCreatedAt > INNERTUBE_MAX_AGE_MS;

    if (innertubeInstance && !forceRefresh && !isStale) {
        return innertubeInstance;
    }

    log('Creating new Innertube instance...');

    // Rotate between client types to avoid detection
    const clientTypes = ['ANDROID', 'IOS'];
    const randomClient = clientTypes[Math.floor(Math.random() * clientTypes.length)];

    innertubeInstance = await Innertube.create({
        // Rotate client type to avoid detection patterns
        client_type: randomClient,
        // Cache the player JS to disk so we don't re-download it
        // on every cold start. This is critical for performance.
        cache: new UniversalCache(true, './.innertube-cache'),
        // Generate session data locally for faster startup
        generate_session_locally: true,
    });

    innertubeCreatedAt = now;
    log(`Innertube instance created with ${randomClient} client.`);

    return innertubeInstance;
}

function log(msg) {
    if (isDev) console.log(`[audio-url] ${msg}`);
}

/**
 * GET /api/audio-url/[videoId]
 *
 * Extracts the direct audio stream URL from YouTube using youtubei.js (InnerTube API).
 * Returns the deciphered CDN URL that mobile clients can stream directly.
 *
 * Redis caching layer (TTL = 2h):
 *   key: demus:audio-url:<videoId>
 *
 * CRITICAL: YouTube URLs expire after ~6 hours. Mobile clients MUST check
 * expiresAt before playback and refetch if expired.
 */
export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { videoId } = req.query;

    if (!videoId || !VIDEO_ID_REGEX.test(videoId)) {
        return res.status(400).json({
            error: 'Invalid videoId. Must be an 11-character YouTube video ID.',
        });
    }

    const cacheKey = `demus:audio-url:${videoId}`;

    // ──────────────────────────────────────────────────────
    // 1. Check Redis cache first
    // ──────────────────────────────────────────────────────
    let redis = null;
    try {
        redis = await getRedis();
        if (redis) {
            const cached = await redis.get(cacheKey);
            if (cached) {
                const data = JSON.parse(cached);

                if (data.expiresAt && data.expiresAt > Date.now()) {
                    log(`Redis cache HIT for ${videoId} (expires in ${Math.round((data.expiresAt - Date.now()) / 1000 / 60)}m)`);
                    res.setHeader('X-Cache', 'HIT');
                    return res.status(200).json(data);
                } else {
                    log(`Redis cache EXPIRED for ${videoId} - will re-extract`);
                    await redis.del(cacheKey);
                }
            } else {
                log(`Redis cache MISS for ${videoId}`);
            }
        }
    } catch (redisErr) {
        if (isDev) console.error('[audio-url] Redis read error:', redisErr.message);
        redis = null;
    }

    // ──────────────────────────────────────────────────────
    // 2. Extract audio URL using youtubei.js with retry
    // ──────────────────────────────────────────────────────
    let lastError = null;

    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            // Enforce rate limiting between requests
            await waitForRateLimit();
            
            // On retry (attempt 1+), force-refresh the Innertube instance
            // in case the player JS / decipher algorithm is stale
            const yt = await getInnertube(attempt > 0);

            log(`Attempt ${attempt + 1}: Extracting audio for ${videoId}...`);

            // getBasicInfo = 1 request (faster)
            // getInfo = 2 requests (includes watch-next data we don't need)
            const info = await yt.getBasicInfo(videoId);

            // ── Check playability ──
            const status = info.playability_status;
            if (status?.status === 'LOGIN_REQUIRED') {
                return res.status(403).json({
                    error: 'Video is age-restricted or requires login',
                    videoId,
                });
            }
            if (status?.status === 'UNPLAYABLE' || status?.status === 'ERROR') {
                return res.status(404).json({
                    error: status?.reason || 'Video unavailable',
                    videoId,
                });
            }

            // ── Verify streaming data exists ──
            if (!info.streaming_data) {
                throw new Error('No streaming data returned');
            }

            // ── Select best audio format ──
            // Strategy: try preferred itags first, fall back to chooseFormat()
            const adaptiveFormats = info.streaming_data.adaptive_formats || [];
            const audioFormats = adaptiveFormats.filter(f =>
                f.mime_type?.startsWith('audio/')
            );

            if (audioFormats.length === 0) {
                throw new Error('No audio formats available');
            }

            let selectedFormat = null;

            // Try preferred itags in order
            for (const itag of PREFERRED_ITAGS) {
                selectedFormat = audioFormats.find(f => f.itag === itag);
                if (selectedFormat) break;
            }

            // Fallback: use library's built-in chooser
            if (!selectedFormat) {
                try {
                    selectedFormat = info.chooseFormat({
                        type: 'audio',
                        quality: 'best',
                    });
                } catch {
                    // If chooseFormat throws, pick highest bitrate manually
                    audioFormats.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
                    selectedFormat = audioFormats[0];
                }
            }

            if (!selectedFormat) {
                throw new Error('Could not select an audio format');
            }

            // ── Decipher the URL ──
            // CRITICAL: YouTube URLs are obfuscated with a signature cipher.
            // You MUST decipher them or you'll get 403s / throttled.
            let audioUrl;
            if (selectedFormat.url) {
                // Some clients (ANDROID) may return pre-deciphered URLs
                audioUrl = selectedFormat.url;
            } else {
                // Decipher the signature cipher to get a playable URL
                audioUrl = selectedFormat.decipher(yt.session.player);
            }

            if (!audioUrl) {
                throw new Error('Failed to decipher audio URL');
            }

            log(`✅ Extracted audio for ${videoId} (itag=${selectedFormat.itag}, ${Math.round((selectedFormat.bitrate || 0) / 1000)}kbps)`);

            const expiresAt = Date.now() + (2 * 60 * 60 * 1000);

            const payload = {
                audioUrl,
                expiresAt,
                videoId,
                format: selectedFormat.mime_type?.split(';')[0] || 'audio/webm',
                bitrate: selectedFormat.bitrate || 0,
                contentLength: parseInt(selectedFormat.content_length) || 0,
            };

            // ──────────────────────────────────────────────
            // 3. Cache in Redis (best-effort, unchanged)
            // ──────────────────────────────────────────────
            try {
                if (redis) {
                    await redis.set(
                        cacheKey,
                        JSON.stringify(payload),
                        'EX',
                        CACHE_TTL_SECONDS
                    );
                    log(`Cached audio URL for ${videoId} (TTL: ${CACHE_TTL_SECONDS}s)`);
                }
            } catch (redisErr) {
                if (isDev) console.error('[audio-url] Redis write error:', redisErr.message);
            }

            // Reset backoff on success
            backoffDelay = 0;
            
            res.setHeader('X-Cache', 'MISS');
            return res.status(200).json(payload);

        } catch (err) {
            lastError = err;
            log(`❌ Attempt ${attempt + 1} failed for ${videoId}: ${err.message}`);

            // Check if this is a rate limit / socket error
            const isRateLimited = 
                err.message?.includes('SocketError') ||
                err.message?.includes('other side closed') ||
                err.message?.includes('ECONNRESET') ||
                err.message?.includes('fetch failed') ||
                err.code === 'UND_ERR_SOCKET';

            if (isRateLimited) {
                // Exponential backoff: 2s, 4s, 8s, etc.
                backoffDelay = Math.min(
                    (backoffDelay || 1000) * 2, 
                    MAX_BACKOFF_DELAY
                );
                log(`⚠️ Rate limit detected! Setting backoff to ${backoffDelay}ms`);
            }

            // Only retry if it looks like a retryable issue
            const isRetryable =
                err.message?.includes('decipher') ||
                err.message?.includes('signature') ||
                err.message?.includes('player') ||
                err.message?.includes('No streaming data') ||
                err.message?.includes('Could not extract') ||
                isRateLimited;

            if (attempt < 2 && isRetryable) {
                const retryDelay = Math.min(1000 * Math.pow(2, attempt), 5000);
                log(`Retrying in ${retryDelay}ms with fresh Innertube instance...`);
                await new Promise(resolve => setTimeout(resolve, retryDelay));
                continue;
            }

            // Non-retryable or final attempt — break out
            break;
        }
    }

    // ──────────────────────────────────────────────────────
    // 4. All attempts failed — classify and respond
    // ──────────────────────────────────────────────────────
    console.error(`[audio-url] Extraction failed for ${videoId}:`, lastError);

    const msg = lastError?.message || '';

    if (msg.includes('unavailable') || msg.includes('private')) {
        return res.status(404).json({
            error: 'Video unavailable or private',
            videoId,
        });
    }
    if (msg.includes('age-restricted') || msg.includes('LOGIN_REQUIRED')) {
        return res.status(403).json({
            error: 'Video is age-restricted',
            videoId,
        });
    }
    if (msg.includes('not a bot') || msg.includes('Sign in')) {
        return res.status(503).json({
            error: 'YouTube bot detection triggered. Retry later.',
            retryAfter: 60,
            videoId,
        });
    }
    if (msg.includes('SocketError') || msg.includes('other side closed') || msg.includes('fetch failed')) {
        return res.status(503).json({
            error: 'YouTube temporarily unavailable (rate limited). Please wait a moment and try again.',
            retryAfter: Math.ceil(backoffDelay / 1000) || 5,
            videoId,
        });
    }

    return res.status(500).json({
        error: 'Failed to extract audio URL',
        message: isDev ? msg : 'Internal server error',
        videoId,
    });
}