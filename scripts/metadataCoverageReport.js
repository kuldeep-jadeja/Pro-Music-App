'use strict';

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

(function loadEnvLocal() {
    if (process.env.MONGODB_URI) return;
    const envCandidates = ['.env.local', '.env'];
    for (const envName of envCandidates) {
        const envPath = path.resolve(__dirname, '..', envName);
        if (!fs.existsSync(envPath)) continue;
        const raw = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
        for (const line of raw) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            const eqIdx = trimmed.indexOf('=');
            if (eqIdx === -1) continue;
            const key = trimmed.slice(0, eqIdx).trim();
            const val = trimmed.slice(eqIdx + 1).trim();
            if (!process.env[key]) process.env[key] = val;
        }
        if (process.env.MONGODB_URI) break;
    }
}());

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }

const TrackSchema = new mongoose.Schema(
    {
        genres: {
            type: [String],
            default: [],
        },
        metadataStatus: {
            type: String,
            default: 'pending',
        },
        genreConfidence: {
            type: Number,
            default: 0,
        },
    },
    { timestamps: true }
);

const KNOWN_STATUSES = ['pending', 'partial', 'complete', 'failed', 'missing'];

function toPercent(part, total) {
    if (!total) return '0.00';
    return ((part / total) * 100).toFixed(2);
}

async function main() {
    console.log('\n=== Metadata Coverage Report (Phase 1) ===\n');

    await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 15_000 });
    console.log('Connected to MongoDB\n');

    const Track = mongoose.models.Track || mongoose.model('Track', TrackSchema);

    const totalTracks = await Track.countDocuments();
    const tracksWithGenres = await Track.countDocuments({
        genres: { $exists: true, $type: 'array', $ne: [] },
    });
    const highConfidenceCount = await Track.countDocuments({
        genreConfidence: { $gte: 0.8 },
    });

    const distributionRaw = await Track.aggregate([
        {
            $project: {
                status: { $ifNull: ['$metadataStatus', 'missing'] },
            },
        },
        {
            $group: {
                _id: '$status',
                count: { $sum: 1 },
            },
        },
        { $sort: { _id: 1 } },
    ]);

    const distribution = new Map(KNOWN_STATUSES.map((status) => [status, 0]));
    for (const row of distributionRaw) {
        const key = typeof row._id === 'string' && row._id.trim() ? row._id : 'missing';
        distribution.set(key, row.count || 0);
    }

    console.log('── Snapshot ─────────────────────────────────────────────');
    console.log(`  Total tracks                     : ${totalTracks}`);
    console.log(`  Tracks with genres               : ${tracksWithGenres} (${toPercent(tracksWithGenres, totalTracks)}%)`);
    console.log(`  High-confidence genres (>= 0.80) : ${highConfidenceCount}`);
    console.log('  metadataStatus distribution:');
    for (const [status, count] of distribution.entries()) {
        console.log(`    - ${status.padEnd(8)}: ${count}`);
    }
    console.log('─────────────────────────────────────────────────────────\n');

    await mongoose.disconnect();
}

main().catch((err) => {
    console.error('\nFatal error:', err.message);
    process.exit(1);
});
