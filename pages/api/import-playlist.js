import { connectDB } from '@/lib/mongodb';
import { withRateLimit } from '@/lib/rateLimit';
import {
    extractPlaylistId,
    getPublicPlaylistData,
} from '@/lib/spotify';
import { batchMatchTracks } from '@/lib/youtube';
import Playlist from '@/models/Playlist';
import Track from '@/models/Track';

/**
 * POST /api/import-playlist
 * Body: { url: "https://open.spotify.com/playlist/..." }
 *
 * 1. Extracts playlist ID from URL
 * 2. Scrapes playlist metadata + tracks from Spotify's public embed page (no API keys)
 * 3. Upserts tracks into MongoDB (deduplicates by spotifyId)
 * 4. Implements global caching — skips tracks that already have a youtubeVideoId
 * 5. Creates Playlist document
 * 6. Kicks off YouTube matching for uncached tracks only (async, non-blocking)
 * 7. Returns the playlist immediately
 */
async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { url } = req.body;

    if (!url) {
        return res.status(400).json({ error: 'Missing "url" in request body' });
    }

    // 1. Extract playlist ID
    const playlistId = extractPlaylistId(url);
    if (!playlistId) {
        return res.status(400).json({ error: 'Invalid Spotify playlist URL' });
    }

    try {
        await connectDB();

        // 2. Fetch playlist info + tracks (scrapes embed page — no API keys needed)
        const { info, tracks: rawTracks } = await getPublicPlaylistData(playlistId);

        // 3. Upsert tracks into MongoDB via bulkWrite (replaces N+1 sequential loop)
        //    - $set for mutable metadata (name, artists, album, albumImage) so
        //      re-imports pick up Spotify-side corrections / new album art URLs.
        //    - $setOnInsert for immutable fields (importedAt) and fields that
        //      must not be overwritten (youtubeVideoId is NOT touched here).
        const bulkOps = rawTracks.map((t) => ({
            updateOne: {
                filter: { spotifyId: t.spotifyId },
                update: {
                    $set: {
                        name: t.name,
                        artists: t.artists,
                        album: t.album,
                        duration: t.duration,
                        albumImage: t.albumImage,
                    },
                    $setOnInsert: {
                        importedAt: new Date(),
                    },
                },
                upsert: true,
            },
        }));

        await Track.bulkWrite(bulkOps, { ordered: false });

        // Single batch fetch — replaces N individual findOneAndUpdate return values
        const spotifyIds = rawTracks.map((t) => t.spotifyId);
        const allTracks = await Track.find({ spotifyId: { $in: spotifyIds } }).lean();

        // Build lookup map for O(1) access by spotifyId
        const trackMap = new Map(allTracks.map((t) => [t.spotifyId, t]));

        // Preserve original playlist ordering from Spotify
        const trackIds = [];
        const uncachedTracks = [];

        for (const t of rawTracks) {
            const doc = trackMap.get(t.spotifyId);
            if (!doc) continue; // Shouldn't happen, but defensive

            trackIds.push(doc._id);

            // Global cache: only queue tracks that don't already have a YouTube match
            if (!doc.youtubeVideoId) {
                uncachedTracks.push(doc);
            }
        }

        // 4. Determine initial status based on cache hits
        const allCached = uncachedTracks.length === 0;
        const initialProgress = allCached ? 100 : 50;

        // 5. Create or update playlist document
        //    NOTE: We set status to 'imported' here — NOT 'matching'.
        //    The atomic guard below is what flips to 'matching' and spawns
        //    the background task, ensuring only one task runs at a time.
        const playlist = await Playlist.findOneAndUpdate(
            { spotifyPlaylistId: playlistId },
            {
                name: info.name,
                description: info.description,
                coverImage: info.coverImage,
                owner: info.owner,
                tracks: trackIds,
                trackCount: trackIds.length,
                // If all tracks are cached, mark ready immediately.
                // Otherwise, mark 'imported' — the atomic guard below
                // will flip to 'matching' if no task is already running.
                ...(allCached
                    ? { status: 'ready' }
                    : { status: 'imported' }),
                importProgress: initialProgress,
            },
            { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
        );

        // 6. Respond immediately
        res.status(200).json({
            success: true,
            playlist: {
                id: playlist._id,
                name: playlist.name,
                trackCount: playlist.trackCount,
                status: playlist.status,
                coverImage: playlist.coverImage,
                uncachedTracks: uncachedTracks.length,
            },
        });

        // 7. Background YouTube matching — fire-and-forget (only uncached tracks)
        //    CRITICAL: Atomic guard prevents duplicate background tasks.
        //    We only flip to 'matching' if the playlist is NOT already in
        //    'matching' status.  If the atomic update returns null, another
        //    import/resume already started matching — we safely skip.
        if (uncachedTracks.length > 0) {
            const canMatch = await Playlist.findOneAndUpdate(
                { _id: playlist._id, status: { $ne: 'matching' } },
                { $set: { status: 'matching' } }
            );

            if (canMatch) {
                batchMatchTracks(uncachedTracks, playlist._id, 1000).catch((err) =>
                    console.error('Background YouTube matching failed:', err.message)
                );
            } else {
                console.log(
                    `Skipping background match for playlist ${playlist._id} — already matching`
                );
            }
        }
    } catch (err) {
        console.error('Import playlist error:', err.message);

        return res.status(500).json({
            error: err.message || 'Failed to import playlist',
        });
    }
}

export default withRateLimit(handler, 10, 60000); // 10 imports per minute
