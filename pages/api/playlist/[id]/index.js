import { connectDB } from '@/lib/mongodb';
import { requireAuth } from '@/lib/requireAuth';
import Playlist from '@/models/Playlist';

/**
 * GET /api/playlist/[id]
 * Returns playlist with populated track data (scoped to authenticated user).
 */
async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { id } = req.query;

    if (!id) {
        return res.status(400).json({ error: 'Missing playlist ID' });
    }

    try {
        await connectDB();

        const playlist = await Playlist.findOne({ _id: id, user: req.user._id })
            .populate('tracks')
            .lean();

        if (!playlist) {
            return res.status(404).json({ error: 'Playlist not found' });
        }

        return res.status(200).json({
            id: playlist._id,
            name: playlist.name,
            description: playlist.description,
            coverImage: playlist.coverImage,
            owner: playlist.owner,
            status: playlist.status,
            importProgress: playlist.importProgress,
            trackCount: playlist.trackCount,
            tracks: playlist.tracks.map((t) => ({
                id: t._id,
                name: t.name,
                artists: t.artists,
                album: t.album,
                duration: t.duration,
                spotifyId: t.spotifyId,
                youtubeVideoId: t.youtubeVideoId,
                albumImage: t.albumImage,
            })),
        });
    } catch (err) {
        console.error('Get playlist error:', err);
        return res.status(500).json({ error: 'Failed to fetch playlist' });
    }
}

export default requireAuth(handler);
