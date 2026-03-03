import mongoose from 'mongoose';

const TrackSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: true,
        },
        artists: {
            type: [String],
            required: true,
        },
        album: String,
        duration: Number, // milliseconds
        spotifyId: {
            type: String,
            required: true,
            unique: true,
        },
        youtubeVideoId: {
            type: String,
            default: null,
        },
        albumImage: String,
        importedAt: {
            type: Date,
            default: Date.now,
        },
    },
    { timestamps: true }
);

// NOTE: Text index on { name, artists } was removed — no code in the codebase
// uses MongoDB $text search.  The index consumed storage and slowed writes
// for zero benefit.  Re-add if a search feature is implemented.

export default mongoose.models.Track || mongoose.model('Track', TrackSchema);
