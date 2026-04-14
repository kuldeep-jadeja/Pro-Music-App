import { connectDB } from '@/lib/mongodb';
import mongoose from 'mongoose';
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
    const normalizedTrackId = Array.isArray(trackId) ? trackId[0] : trackId;

    if (!normalizedTrackId) {
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
        const trackLookup = [
            { spotifyId: normalizedTrackId },
            { youtubeVideoId: normalizedTrackId },
        ];
        if (mongoose.Types.ObjectId.isValid(normalizedTrackId)) {
            trackLookup.push({ _id: normalizedTrackId });
        }

        const track = await Track.findOne({ $or: trackLookup }).select('_id');

        if (!track) {
            return res.status(404).json({ error: 'Track not found' });
        }

        // 3. Remove track atomically and keep trackCount consistent with persisted array size
        const updatedPlaylist = await Playlist.findOneAndUpdate(
            {
                _id: likedPlaylist._id,
                tracks: track._id,
            },
            [
                {
                    $set: {
                        tracks: {
                            $filter: {
                                input: '$tracks',
                                as: 'existingTrackId',
                                cond: { $ne: ['$$existingTrackId', track._id] },
                            },
                        },
                    },
                },
                { $set: { trackCount: { $size: '$tracks' } } },
            ],
            { new: true }
        ).select('_id');

        if (!updatedPlaylist) {
            return res
                .status(404)
                .json({ error: 'Track not in Liked Songs playlist' });
        }

        return res.status(200).json({
            success: true,
            playlistId: updatedPlaylist._id,
            trackId: track._id,
        });
    } catch (err) {
        console.error('Unlike track error:', err);
        return res.status(500).json({ error: 'Failed to unlike track' });
    }
}

export default requireAuth(handler);
