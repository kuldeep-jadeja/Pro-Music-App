import { connectDB } from '@/lib/mongodb';
import { withRateLimit } from '@/lib/rateLimit';
import { batchMatchTracks } from '@/lib/youtube';
import Playlist from '@/models/Playlist';
import Track from '@/models/Track';
import mongoose from 'mongoose';

/**
 * POST /api/youtube-match
 * Body: { playlistId: "..." }
 *
 * Resume YouTube matching for a paused playlist.
 * Fetches the playlist, filters for unmatched tracks, sets status
 * back to 'matching', responds immediately, then continues
 * matching in the background (fire-and-forget).
 */
async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { playlistId } = req.body;

    if (!playlistId) {
        return res.status(400).json({ error: 'Missing "playlistId" in request body' });
    }

    // Validate ObjectId format before querying to prevent CastError / NoSQL injection
    if (!mongoose.Types.ObjectId.isValid(playlistId)) {
        return res.status(400).json({ error: 'Invalid playlistId format' });
    }

    try {
        await connectDB();

        // Fetch playlist WITHOUT populating tracks — we query unmatched
        // tracks directly below, avoiding loading all tracks into memory.
        const playlist = await Playlist.findById(playlistId).lean();

        if (!playlist) {
            return res.status(404).json({ error: 'Playlist not found' });
        }

        // CRITICAL: Reject resume if matching is already in progress.
        // Prevents duplicate background tasks racing on the same playlist.
        if (playlist.status === 'matching') {
            return res.status(409).json({
                error: 'Matching is already in progress for this playlist',
            });
        }

        // Enforce cooldown after an IP-block pause.  If the user clicks
        // Resume before the cooldown expires, return 429 with the seconds
        // remaining.  This prevents spam-resuming into a still-active block,
        // which would extend the YouTube ban.
        if (playlist.retryAfter && new Date() < new Date(playlist.retryAfter)) {
            const retryAfterSec = Math.ceil(
                (new Date(playlist.retryAfter).getTime() - Date.now()) / 1000
            );
            return res.status(429).json({
                error: `Rate limited — please wait ${retryAfterSec}s before resuming`,
                retryAfter: retryAfterSec,
            });
        }

        // Query unmatched tracks directly from the Track collection instead
        // of populating the entire tracks array and filtering in JS.
        // For a 2000-track playlist with 3 unmatched, this reads 3 docs
        // instead of 2000.
        const unmatchedTracks = await Track.find({
            _id: { $in: playlist.tracks },
            $or: [
                { youtubeVideoId: null },
                { youtubeVideoId: { $exists: false } },
            ],
        }).lean();

        if (unmatchedTracks.length === 0) {
            // Everything is already matched
            await Playlist.updateOne(
                { _id: playlistId },
                { $set: { status: 'ready', importProgress: 100 } }
            );
            return res.status(200).json({
                success: true,
                message: 'All tracks already matched',
            });
        }

        // Atomic guard: only flip to 'matching' if not already in that state.
        // This is a second layer of protection (the status check above is
        // optimistic; this handles the race where two resume requests arrive
        // simultaneously and both pass the check above).
        const canMatch = await Playlist.findOneAndUpdate(
            { _id: playlistId, status: { $ne: 'matching' } },
            { $set: { status: 'matching' } }
        );

        if (!canMatch) {
            return res.status(409).json({
                error: 'Matching is already in progress for this playlist',
            });
        }

        // Respond immediately (fire-and-forget)
        res.status(200).json({
            success: true,
            message: 'Resumed matching',
            remaining: unmatchedTracks.length,
        });

        // Background: continue matching unmatched tracks
        batchMatchTracks(unmatchedTracks, playlistId, 1000).catch((err) =>
            console.error('Resume matching failed:', err.message)
        );
    } catch (err) {
        console.error('YouTube match resume error:', err);
        return res.status(500).json({ error: 'Failed to resume matching' });
    }
}

export default withRateLimit(handler, 20, 60000); // 20 resume requests per minute
