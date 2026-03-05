import mongoose from 'mongoose';

const PlaylistSchema = new mongoose.Schema(
    {
        // ── Owner (auth) ────────────────────────────────────────────────
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        name: {
            type: String,
            required: true,
        },
        description: String,
        coverImage: String,
        spotifyPlaylistId: {
            type: String,
            required: true,
            // unique constraint is now a compound index — see bottom of file.
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

// Compound unique index: same Spotify playlist can exist once per user, but
// different users may each import the same playlist independently.
PlaylistSchema.index({ spotifyPlaylistId: 1, user: 1 }, { unique: true });

export default mongoose.models.Playlist || mongoose.model('Playlist', PlaylistSchema);
