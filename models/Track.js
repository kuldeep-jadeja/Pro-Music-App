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
        genres: {
            type: [String],
            default: [],
        },
        primaryGenre: {
            type: String,
            default: null,
        },
        metadataStatus: {
            type: String,
            enum: ['pending', 'partial', 'complete', 'failed'],
            default: 'pending',
        },
        metadataUpdatedAt: {
            type: Date,
            default: null,
        },
        metadataAttempts: {
            type: Number,
            default: 0,
            min: 0,
        },
        genreConfidence: {
            type: Number,
            default: 0,
            min: 0,
            max: 1,
        },
        metadataFingerprint: {
            type: String,
            default: null,
        },
        metadataSources: {
            genre: String,
            album: String,
        },
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
