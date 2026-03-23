import { connectDB } from '@/lib/mongodb';
import { requireAuth } from '@/lib/requireAuth';
import Playlist from '@/models/Playlist';

/**
 * GET /api/favorites
 *
 * Returns all favorited tracks from the user's "Liked Songs" playlist.
 * The "Liked Songs" playlist is a special playlist with spotifyPlaylistId: "DEMUS_LIKED_SONGS"
 */
async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        await connectDB();

        const likedPlaylist = await Playlist.findOne({
            user: req.user._id,
            spotifyPlaylistId: 'DEMUS_LIKED_SONGS',
        })
            .populate('tracks')
            .lean();

        if (!likedPlaylist) {
            return res.status(200).json({ favorites: [] });
        }

        return res.status(200).json({
            favorites: likedPlaylist.tracks || [],
            playlistId: likedPlaylist._id,
        });
    } catch (err) {
        console.error('Fetch favorites error:', err);
        return res.status(500).json({ error: 'Failed to fetch favorites' });
    }
}

export default requireAuth(handler);
