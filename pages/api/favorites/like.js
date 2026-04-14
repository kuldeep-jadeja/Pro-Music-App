import { connectDB } from '@/lib/mongodb';
import { withRateLimit } from '@/lib/rateLimit';
import { requireAuth } from '@/lib/requireAuth';
import Playlist from '@/models/Playlist';
import Track from '@/models/Track';

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

        // 1. Find or create the "Liked Songs" playlist
        let likedPlaylist = await Playlist.findOne({
            user: req.user._id,
            spotifyPlaylistId: 'DEMUS_LIKED_SONGS',
        });

        if (!likedPlaylist) {
            likedPlaylist = await Playlist.create({
                user: req.user._id,
                name: 'Liked Songs',
                description: 'Your favorite tracks',
                spotifyPlaylistId: 'DEMUS_LIKED_SONGS',
                coverImage: '/liked-songs-icon.png',
                status: 'ready',
                trackCount: 0,
                tracks: [],
            });
        }

        // 2. Find or create the track
        let trackDoc = await Track.findOne({ spotifyId: track.spotifyId });

        if (!trackDoc) {
            trackDoc = await Track.create({
                name: track.name,
                artists: track.artists || [],
                album: track.album,
                duration: track.duration,
                spotifyId: track.spotifyId,
                youtubeVideoId: track.youtubeVideoId || null,
                albumImage: track.albumImage,
            });
        } else {
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
        }

        // 3. Add track to playlist if not already present
        if (!likedPlaylist.tracks.includes(trackDoc._id)) {
            likedPlaylist.tracks.push(trackDoc._id);
            likedPlaylist.trackCount = likedPlaylist.tracks.length;
            await likedPlaylist.save();
        }

        return res.status(200).json({
            success: true,
            playlistId: likedPlaylist._id,
            trackId: trackDoc._id,
        });
    } catch (err) {
        console.error('Like track error:', err);
        return res.status(500).json({ error: 'Failed to like track' });
    }
}

export default requireAuth(withRateLimit(handler, { maxRequests: 100, windowMs: 60000 }));
