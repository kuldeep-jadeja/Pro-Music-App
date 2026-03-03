import { connectDB } from '@/lib/mongodb';
import Playlist from '@/models/Playlist';
import mongoose from 'mongoose';

/**
 * GET /api/playlist/[id]/status
 *
 * Lightweight polling endpoint that returns ONLY status and importProgress.
 * No .populate('tracks'), no track serialization — just two fields + a
 * .select().lean() query.  Designed for the 3-second polling loop during
 * matching so the client doesn't hammer MongoDB with full-populate queries.
 *
 * The client should switch to the full GET /api/playlist/[id] endpoint
 * (which includes tracks) only once status transitions to 'ready'.
 */
export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { id } = req.query;

    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ error: 'Invalid playlist ID' });
    }

    try {
        await connectDB();

        const playlist = await Playlist.findById(id)
            .select('status importProgress')
            .lean();

        if (!playlist) {
            return res.status(404).json({ error: 'Playlist not found' });
        }

        return res.status(200).json({
            status: playlist.status,
            importProgress: playlist.importProgress,
        });
    } catch (err) {
        console.error('Status poll error:', err);
        return res.status(500).json({ error: 'Failed to fetch status' });
    }
}
