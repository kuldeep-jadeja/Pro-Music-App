import { connectDB } from '@/lib/mongodb';
import Track from '@/models/Track';
import { searchYouTubeTrack, enqueue } from '@/lib/youtube';
import mongoose from 'mongoose';

/**
 * POST /api/match-youtube
 *
 * Body: { title: string, artist: string, trackId?: string }
 *
 * Flow:
 *   1. Check MongoDB cache (Track collection) for an existing youtubeVideoId.
 *      — If trackId is supplied, look up by _id (fast, indexed).
 *      — Otherwise fall back to a case-insensitive title + artist query.
 *   2. If a cached youtubeVideoId exists → return immediately.
 *   3. If not cached → scrape YouTube search results via yt-search,
 *      score candidates, store the best match in MongoDB, and return.
 *
 * This endpoint is the single entry-point for the client playback flow:
 *   User presses play → POST /api/match-youtube → receive youtubeId →
 *   PlayerContext.play(youtubeId)
 */
export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { title, artist, trackId } = req.body;

    if (!title || !artist) {
        return res.status(400).json({ error: 'Missing title or artist' });
    }

    try {
        await connectDB();

        // ── 1. Check MongoDB cache ────────────────────────────────
        let track = null;

        // Prefer lookup by _id when the client provides it (indexed, O(1))
        if (trackId) {
            track = await Track.findById(trackId).lean();
        }

        // Fallback: case-insensitive title + first artist
        if (!track) {
            track = await Track.findOne({
                name: { $regex: new RegExp(`^${escapeRegex(title)}$`, 'i') },
                artists: { $regex: new RegExp(escapeRegex(artist), 'i') },
            }).lean();
        }

        // ── 2. Return cached result if available ──────────────────
        if (track?.youtubeVideoId) {
            res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400');
            return res.status(200).json({
                youtubeId: track.youtubeVideoId,
                cached: true,
            });
        }

        // ── 3. Scrape YouTube for the best match ──────────────────
        // Route through the global queue to prevent concurrent yt-search
        // requests from different callers (same IP-block protection used by
        // batchMatchTracks during playlist import).
        const youtubeId = await enqueue(() =>
            searchYouTubeTrack(title, artist, track?.duration ?? null)
        );

        if (!youtubeId) {
            return res.status(404).json({ error: 'No YouTube match found' });
        }

        // ── 4. Persist result in MongoDB ──────────────────────────
        if (track) {
            await Track.updateOne(
                { _id: track._id },
                { $set: { youtubeVideoId: youtubeId } },
            );
        }
        // If no existing Track document was found we still return the videoId.
        // We do NOT create a new Track doc here because the schema requires
        // fields (spotifyId, etc.) that aren't available from the client.

        res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400');
        return res.status(200).json({
            youtubeId,
            cached: false,
        });
    } catch (err) {
        console.error('match-youtube error:', err);
        return res.status(500).json({ error: 'Failed to match track' });
    }
}

/**
 * Escape special regex characters in a string to prevent ReDoS / injection.
 */
function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
