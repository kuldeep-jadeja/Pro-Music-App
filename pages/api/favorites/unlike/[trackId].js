import { connectDB } from '@/lib/mongodb';
import { requireAuth } from '@/lib/requireAuth';
import Playlist from '@/models/Playlist';
import Track from '@/models/Track';

/**
 * DELETE /api/favorites/unlike/:trackId
 *
 * Removes a track from the user's "Liked Songs" playlist.
 * The trackId can be either:
 * - MongoDB _id
 * - spotifyId
 * - youtubeVideoId
 */
async function handler(req, res) {
    if (req.method !== 'DELETE') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { trackId } = req.query;

    if (!trackId) {
        return res.status(400).json({ error: 'Missing trackId parameter' });
    }

    try {
        await connectDB();

        // 1. Find the "Liked Songs" playlist
        const likedPlaylist = await Playlist.findOne({
            user: req.user._id,
            spotifyPlaylistId: 'DEMUS_LIKED_SONGS',
        });

        if (!likedPlaylist) {
            return res
                .status(404)
                .json({ error: 'Liked Songs playlist not found' });
        }

        // 2. Find the track by _id, spotifyId, or youtubeVideoId
        const track = await Track.findOne({
            $or: [
                { _id: trackId },
                { spotifyId: trackId },
                { youtubeVideoId: trackId },
            ],
        });

        if (!track) {
            return res.status(404).json({ error: 'Track not found' });
        }

        // 3. Remove track from playlist
        const trackIndex = likedPlaylist.tracks.findIndex(
            (id) => id.toString() === track._id.toString()
        );

        if (trackIndex === -1) {
            return res
                .status(404)
                .json({ error: 'Track not in Liked Songs playlist' });
        }

        likedPlaylist.tracks.splice(trackIndex, 1);
        likedPlaylist.trackCount = likedPlaylist.tracks.length;
        await likedPlaylist.save();

        return res.status(200).json({
            success: true,
            playlistId: likedPlaylist._id,
            trackId: track._id,
        });
    } catch (err) {
        console.error('Unlike track error:', err);
        return res.status(500).json({ error: 'Failed to unlike track' });
    }
}

export default requireAuth(handler);