import { connectDB } from '@/lib/mongodb';
import { requireAuth } from '@/lib/requireAuth';
import Playlist from '@/models/Playlist';

/**
 * GET /api/playlists
 *
 * Returns all playlists belonging to the authenticated user.
 * Lightweight projection — no track population.
 */
async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        await connectDB();

        const playlists = await Playlist.find({ user: req.user._id })
            .select('name status importProgress spotifyPlaylistId coverImage')
            .sort({ createdAt: -1 })
            .lean();

        return res.status(200).json({ playlists });
    } catch (err) {
        console.error('Fetch playlists error:', err);
        return res.status(500).json({ error: 'Failed to fetch playlists' });
    }
}

export default requireAuth(handler);
