import mongoose from 'mongoose';

const PlaylistSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: true,
        },
        description: String,
        coverImage: String,
        // unique: true prevents duplicate playlist documents when two users
        // import the same Spotify URL at the exact same instant (MongoDB race
        // condition on concurrent findOneAndUpdate upserts with non-unique index).
        spotifyPlaylistId: {
            type: String,
            required: true,
            unique: true,
        },
        owner: {
            type: String, // spotify user display name or id
        },
        tracks: [
            {
                type: mongoose.Schema.Types.ObjectId,
                ref: 'Track',
            },
        ],
        trackCount: {
            type: Number,
            default: 0,
        },
        importedBy: {
            type: String, // could be user ID or session ID
        },
        status: {
            type: String,
            // 'imported' = tracks saved, matching not yet started (Phase 2 atomic guard)
            enum: ['imported', 'matching', 'ready', 'paused', 'error'],
            default: 'imported',
        },
        pausedAt: {
            type: Date,
        },
        // Minimum time (epoch ms) before resume is allowed after an IP block.
        // Set by batchMatchTracks on yt-search failure; enforced by the
        // youtube-match resume route.  Prevents users from spam-resuming
        // into a still-active YouTube IP block.
        retryAfter: {
            type: Date,
        },
        importProgress: {
            type: Number, // 0-100
            default: 0,
        },
        errorMessage: String,
    },
    { timestamps: true }
);

// Index declared in schema via `unique: true` — no separate .index() call needed.

export default mongoose.models.Playlist || mongoose.model('Playlist', PlaylistSchema);
