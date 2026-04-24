'use strict';

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

(function loadEnv() {
    const envFiles = ['.env.local', '.env'];
    for (const envFile of envFiles) {
        const envPath = path.resolve(__dirname, '..', envFile);
        if (!fs.existsSync(envPath)) continue;
        const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            const idx = trimmed.indexOf('=');
            if (idx === -1) continue;
            const key = trimmed.slice(0, idx).trim();
            const val = trimmed.slice(idx + 1).trim();
            if (!process.env[key]) process.env[key] = val;
        }
    }
}());

if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI not set');
    process.exit(1);
}

const TrackSchema = new mongoose.Schema(
    {
        name: String,
        artists: [String],
        album: String,
        albumImage: String,
        spotifyId: String,
        youtubeVideoId: String,
        duration: Number,
        genres: { type: [String], default: [] },
        primaryGenre: { type: String, default: null },
        metadataStatus: {
            type: String,
            enum: ['pending', 'partial', 'complete', 'failed'],
            default: 'pending',
        },
        metadataUpdatedAt: { type: Date, default: null },
        metadataAttempts: { type: Number, default: 0 },
        genreConfidence: { type: Number, default: 0 },
        metadataSources: {
            genre: String,
            album: String,
        },
        importedAt: { type: Date, default: null },
    },
    { timestamps: true }
);

const PlaylistSchema = new mongoose.Schema(
    {
        status: {
            type: String,
            enum: ['imported', 'matching', 'ready', 'paused', 'error'],
            default: 'imported',
        },
        importProgress: { type: Number, default: 0 },
        retryAfter: { type: Date, default: null },
        trackCount: { type: Number, default: 0 },
        tracks: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Track' }],
    },
    { timestamps: true }
);

const UserSchema = new mongoose.Schema(
    {
        email: String,
    },
    { timestamps: true }
);

function pct(value, total) {
    if (!total) return '0.00%';
    return `${((value / total) * 100).toFixed(2)}%`;
}

function line(label, value) {
    return `  ${label.padEnd(34)} ${String(value)}`;
}

function safeStatus(status) {
    return typeof status === 'string' && status.trim() ? status.trim() : 'missing';
}

async function main() {
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15_000 });

    const Track = mongoose.models.Track || mongoose.model('Track', TrackSchema);
    const Playlist = mongoose.models.Playlist || mongoose.model('Playlist', PlaylistSchema);
    const User = mongoose.models.User || mongoose.model('User', UserSchema);

    const now = new Date();

    const [
        totalTracks,
        totalPlaylists,
        totalUsers,
        tracksMissingAlbum,
        tracksMissingImage,
        tracksMissingArtists,
        tracksWithYoutube,
        tracksWithGenres,
        tracksMissingGenres,
        highConfidenceGenres,
        mediumConfidenceGenres,
        lowConfidenceGenres,
        coreCompleteTracks,
        fullyEnrichedTracks,
        pausedPlaylists,
        blockedPlaylists,
    ] = await Promise.all([
        Track.countDocuments(),
        Playlist.countDocuments(),
        User.countDocuments(),
        Track.countDocuments({
            $or: [{ album: null }, { album: { $exists: false } }, { album: '' }, { album: 'Unknown Album' }],
        }),
        Track.countDocuments({
            $or: [{ albumImage: null }, { albumImage: { $exists: false } }, { albumImage: '' }],
        }),
        Track.countDocuments({
            $or: [{ artists: { $exists: false } }, { artists: { $size: 0 } }],
        }),
        Track.countDocuments({
            youtubeVideoId: { $exists: true, $nin: [null, ''] },
        }),
        Track.countDocuments({
            genres: { $exists: true, $type: 'array', $ne: [] },
        }),
        Track.countDocuments({
            $or: [{ genres: { $exists: false } }, { genres: { $size: 0 } }],
        }),
        Track.countDocuments({
            genres: { $exists: true, $type: 'array', $ne: [] },
            genreConfidence: { $gte: 0.8 },
        }),
        Track.countDocuments({
            genres: { $exists: true, $type: 'array', $ne: [] },
            genreConfidence: { $gte: 0.5, $lt: 0.8 },
        }),
        Track.countDocuments({
            genres: { $exists: true, $type: 'array', $ne: [] },
            genreConfidence: { $gt: 0, $lt: 0.5 },
        }),
        Track.countDocuments({
            name: { $exists: true, $nin: [null, ''] },
            artists: { $exists: true, $not: { $size: 0 } },
            album: { $exists: true, $nin: [null, '', 'Unknown Album'] },
            albumImage: { $exists: true, $nin: [null, ''] },
            youtubeVideoId: { $exists: true, $nin: [null, ''] },
        }),
        Track.countDocuments({
            name: { $exists: true, $nin: [null, ''] },
            artists: { $exists: true, $not: { $size: 0 } },
            album: { $exists: true, $nin: [null, '', 'Unknown Album'] },
            albumImage: { $exists: true, $nin: [null, ''] },
            youtubeVideoId: { $exists: true, $nin: [null, ''] },
            genres: { $exists: true, $type: 'array', $ne: [] },
        }),
        Playlist.countDocuments({ status: 'paused' }),
        Playlist.countDocuments({ retryAfter: { $gt: now } }),
    ]);

    const [
        metadataStatusRows,
        genreSourceRows,
        playlistStatusRows,
        attemptsStatsRows,
        importProgressStatsRows,
    ] = await Promise.all([
        Track.aggregate([
            { $project: { status: { $ifNull: ['$metadataStatus', 'missing'] } } },
            { $group: { _id: '$status', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
        ]),
        Track.aggregate([
            { $project: { source: { $ifNull: ['$metadataSources.genre', 'missing'] } } },
            { $group: { _id: '$source', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 12 },
        ]),
        Playlist.aggregate([
            { $project: { status: { $ifNull: ['$status', 'missing'] } } },
            { $group: { _id: '$status', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
        ]),
        Track.aggregate([
            {
                $group: {
                    _id: null,
                    avgAttempts: { $avg: { $ifNull: ['$metadataAttempts', 0] } },
                    maxAttempts: { $max: { $ifNull: ['$metadataAttempts', 0] } },
                    touched: {
                        $sum: {
                            $cond: [{ $gt: [{ $ifNull: ['$metadataAttempts', 0] }, 0] }, 1, 0],
                        },
                    },
                },
            },
        ]),
        Playlist.aggregate([
            {
                $group: {
                    _id: null,
                    avgProgress: { $avg: { $ifNull: ['$importProgress', 0] } },
                    maxProgress: { $max: { $ifNull: ['$importProgress', 0] } },
                },
            },
        ]),
    ]);

    const metadataStatus = new Map(metadataStatusRows.map((row) => [safeStatus(row._id), row.count || 0]));
    const playlistStatus = new Map(playlistStatusRows.map((row) => [safeStatus(row._id), row.count || 0]));
    const attemptsStats = attemptsStatsRows[0] || { avgAttempts: 0, maxAttempts: 0, touched: 0 };
    const importStats = importProgressStatsRows[0] || { avgProgress: 0, maxProgress: 0 };

    console.log('\n=== DB STATUS: FULL METRICS ===\n');

    console.log('Tracks');
    console.log(line('Total tracks', totalTracks));
    console.log(line('Core complete (album+image+yt+artists)', `${coreCompleteTracks} (${pct(coreCompleteTracks, totalTracks)})`));
    console.log(line('Fully enriched (+genres)', `${fullyEnrichedTracks} (${pct(fullyEnrichedTracks, totalTracks)})`));
    console.log(line('With YouTube video', `${tracksWithYoutube} (${pct(tracksWithYoutube, totalTracks)})`));
    console.log(line('With genres', `${tracksWithGenres} (${pct(tracksWithGenres, totalTracks)})`));
    console.log(line('Missing genres', `${tracksMissingGenres} (${pct(tracksMissingGenres, totalTracks)})`));
    console.log(line('Missing album', tracksMissingAlbum));
    console.log(line('Missing album image', tracksMissingImage));
    console.log(line('Missing artists[]', tracksMissingArtists));
    console.log('');

    console.log('Genre confidence');
    console.log(line('High (>= 0.80)', highConfidenceGenres));
    console.log(line('Medium (0.50 - 0.79)', mediumConfidenceGenres));
    console.log(line('Low (0.01 - 0.49)', lowConfidenceGenres));
    console.log('');

    console.log('Metadata processing');
    console.log(line('Tracks touched (attempts > 0)', attemptsStats.touched || 0));
    console.log(line('Average metadata attempts', Number(attemptsStats.avgAttempts || 0).toFixed(2)));
    console.log(line('Max metadata attempts', attemptsStats.maxAttempts || 0));
    console.log(line('Current provider order env', process.env.GENRE_PROVIDER_ORDER || 'not set'));
    console.log('');

    console.log('metadataStatus distribution');
    for (const [status, count] of metadataStatus.entries()) {
        console.log(line(`- ${status}`, count));
    }
    console.log('');

    console.log('Top genre sources');
    for (const row of genreSourceRows) {
        console.log(line(`- ${safeStatus(row._id)}`, row.count || 0));
    }
    console.log('');

    console.log('Playlists');
    console.log(line('Total playlists', totalPlaylists));
    console.log(line('Paused playlists', pausedPlaylists));
    console.log(line('Blocked by retryAfter', blockedPlaylists));
    console.log(line('Average importProgress', `${Number(importStats.avgProgress || 0).toFixed(2)}%`));
    console.log(line('Max importProgress', `${Number(importStats.maxProgress || 0).toFixed(2)}%`));
    for (const [status, count] of playlistStatus.entries()) {
        console.log(line(`- status:${status}`, count));
    }
    console.log('');

    console.log('Users');
    console.log(line('Total users', totalUsers));
    console.log('');

    await mongoose.disconnect();
}

main().catch(async (err) => {
    console.error('Fatal error:', err.message);
    try { await mongoose.disconnect(); } catch (_) { /* noop */ }
    process.exit(1);
});
