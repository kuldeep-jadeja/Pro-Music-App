import { connectDB } from '@/lib/mongodb';
import { withRateLimit } from '@/lib/rateLimit';
import { requireAuth } from '@/lib/requireAuth';
import Playlist from '@/models/Playlist';
import Track from '@/models/Track';

const LIKED_PLAYLIST_ID = 'DEMUS_LIKED_SONGS';

/**
 * POST /api/favorites/like
 * Body: { track: { spotifyId, name, artists, albumImage, youtubeVideoId, duration, album } }
 *
 * 1. Finds or creates the user's "Liked Songs" playlist (spotifyPlaylistId: "DEMUS_LIKED_SONGS")
 * 2. Finds or creates the track in the global Track collection
 * 3. Adds the track to the playlist if not already present
 * 4. Returns the updated playlist
 */
async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { track } = req.body;

    if (!track || !track.spotifyId) {
        return res
            .status(400)
            .json({ error: 'Missing track data or track.spotifyId' });
    }

    try {
        await connectDB();

        // 1. Find or create the "Liked Songs" playlist atomically
        const likedPlaylist = await getOrCreateLikedPlaylist(req.user._id);

        // 2. Find or create the track atomically
        const trackDoc = await getOrCreateTrack(track);

        // Update track metadata if provided (e.g., YouTube match was completed)
        const updates = {};
        if (track.youtubeVideoId && !trackDoc.youtubeVideoId) {
            updates.youtubeVideoId = track.youtubeVideoId;
        }
        if (track.albumImage && !trackDoc.albumImage) {
            updates.albumImage = track.albumImage;
        }
        if (Object.keys(updates).length > 0) {
            await Track.updateOne({ _id: trackDoc._id }, { $set: updates });
        }

        // 3. Add track atomically and keep trackCount in sync from persisted array size
        const updatedPlaylist = await Playlist.findOneAndUpdate(
            { _id: likedPlaylist._id },
            [
                { $set: { tracks: { $setUnion: ['$tracks', [trackDoc._id]] } } },
                { $set: { trackCount: { $size: '$tracks' } } },
            ],
            { new: true }
        ).select('_id');

        return res.status(200).json({
            success: true,
            playlistId: updatedPlaylist?._id || likedPlaylist._id,
            trackId: trackDoc._id,
        });
    } catch (err) {
        console.error('Like track error:', err);
        return res.status(500).json({ error: 'Failed to like track' });
    }
}

export default requireAuth(withRateLimit(handler, 100, 60000));

async function getOrCreateLikedPlaylist(userId) {
    try {
        const playlist = await Playlist.findOneAndUpdate(
            { user: userId, spotifyPlaylistId: LIKED_PLAYLIST_ID },
            {
                $setOnInsert: {
                    user: userId,
                    name: 'Liked Songs',
                    description: 'Your favorite tracks',
                    spotifyPlaylistId: LIKED_PLAYLIST_ID,
                    coverImage: '/liked-songs-icon.png',
                    status: 'ready',
                    trackCount: 0,
                    tracks: [],
                },
            },
            { new: true, upsert: true, setDefaultsOnInsert: true }
        );
        if (!playlist) throw new Error('Failed to resolve liked playlist');
        return playlist;
    } catch (err) {
        if (err?.code === 11000) {
            const existing = await Playlist.findOne({
                user: userId,
                spotifyPlaylistId: LIKED_PLAYLIST_ID,
            });
            if (existing) return existing;
        }
        throw err;
    }
}

async function getOrCreateTrack(track) {
    try {
        const trackDoc = await Track.findOneAndUpdate(
            { spotifyId: track.spotifyId },
            {
                $setOnInsert: {
                    name: track.name,
                    artists: track.artists || [],
                    album: track.album,
                    duration: track.duration,
                    spotifyId: track.spotifyId,
                    youtubeVideoId: track.youtubeVideoId || null,
                    albumImage: track.albumImage,
                },
            },
            { new: true, upsert: true, setDefaultsOnInsert: true }
        );
        if (!trackDoc) throw new Error('Failed to resolve track');
        return trackDoc;
    } catch (err) {
        if (err?.code === 11000) {
            const existing = await Track.findOne({ spotifyId: track.spotifyId });
            if (existing) return existing;
        }
        throw err;
    }
}
