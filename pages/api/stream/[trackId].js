import { connectDB } from '@/lib/mongodb';
import Track from '@/models/Track';
import mongoose from 'mongoose';

/**
 * GET /api/stream/[trackId]
 * Returns the YouTube video ID and embed-ready data for a given track.
 * The actual streaming happens via YouTube IFrame API on the frontend.
 */
export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { trackId } = req.query;

    if (!trackId) {
        return res.status(400).json({ error: 'Missing trackId' });
    }

    if (!mongoose.Types.ObjectId.isValid(trackId)) {
        return res.status(400).json({ error: 'Invalid ID format' });
    }

    try {
        await connectDB();

        const track = await Track.findById(trackId).lean();

        if (!track) {
            return res.status(404).json({ error: 'Track not found' });
        }

        if (!track.youtubeVideoId) {
            return res.status(404).json({
                error: 'No YouTube match available for this track',
                track: { name: track.name, artists: track.artists },
            });
        }

        // Set cache headers (video IDs are stable)
        res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400');

        return res.status(200).json({
            trackId: track._id,
            name: track.name,
            artists: track.artists,
            album: track.album,
            albumImage: track.albumImage,
            duration: track.duration,
            youtubeVideoId: track.youtubeVideoId,
            embedUrl: `https://www.youtube.com/embed/${track.youtubeVideoId}?autoplay=1&enablejsapi=1`,
        });
    } catch (err) {
        console.error('Stream error:', err);
        return res.status(500).json({ error: 'Failed to get stream data' });
    }
}
