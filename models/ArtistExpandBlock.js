import mongoose from 'mongoose';

const ArtistExpandBlockSchema = new mongoose.Schema(
    {
        artistName: {
            type: String,
            required: true,
        },
        normalizedArtistName: {
            type: String,
            required: true,
            unique: true,
            index: true,
        },
        artistSpotifyId: {
            type: String,
            default: null,
            index: true,
        },
    },
    { timestamps: true }
);

export default mongoose.models.ArtistExpandBlock ||
    mongoose.model('ArtistExpandBlock', ArtistExpandBlockSchema);
