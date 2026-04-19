'use strict';

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

(function loadEnvLocal() {
    if (process.env.MONGODB_URI) return;
    const envPath = path.resolve(__dirname, '..', '.env.local');
    if (!fs.existsSync(envPath)) return;
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
}());

const MONGODB_URI = process.env.MONGODB_URI;
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const limitIdx = args.indexOf('--limit');
const LIMIT = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : Infinity;
const MIN_COVERAGE = Math.max(0, Math.min(1, Number(process.env.ALBUM_GENRE_MIN_COVERAGE || 0.3)));

if (!MONGODB_URI) {
    console.error('[propagateAlbumGenres] MONGODB_URI not set');
    process.exit(1);
}

const TrackSchema = new mongoose.Schema(
    {
        name: String,
        artists: [String],
        album: String,
        genres: { type: [String], default: [] },
        primaryGenre: { type: String, default: null },
        genreConfidence: { type: Number, default: 0 },
        metadataSources: { genre: String, album: String },
        metadataUpdatedAt: { type: Date, default: null },
        metadataAttempts: { type: Number, default: 0 },
    },
    { timestamps: true }
);

function normalizeArtistKey(value) {
    if (typeof value !== 'string') return null;
    const key = value
        .split(/[,&/]/)[0]
        .replace(/\b(feat|ft|with)\b.*$/i, '')
        .trim()
        .toLowerCase();
    return key || null;
}

function normalizeAlbumKey(value) {
    if (typeof value !== 'string') return null;
    const key = value.trim().toLowerCase();
    return key || null;
}

function normalizeGenreToken(value) {
    if (typeof value !== 'string') return null;
    const token = value
        .trim()
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/&/g, ' and ')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return token || null;
}

function topGenresFromWeights(weights, max = 5) {
    return [...weights.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([genre]) => genre)
        .slice(0, max);
}

async function run() {
    if (DRY_RUN) console.log('[propagateAlbumGenres] DRY RUN — no DB writes');
    if (LIMIT !== Infinity) console.log(`[propagateAlbumGenres] Limit: ${LIMIT}`);
    console.log(`[propagateAlbumGenres] Min coverage: ${(MIN_COVERAGE * 100).toFixed(0)}%`);

    await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 15_000 });
    const Track = mongoose.models.Track || mongoose.model('Track', TrackSchema);

    const tracks = await Track.find({
        album: { $exists: true, $type: 'string', $nin: ['', 'Unknown Album'] },
        artists: { $exists: true, $not: { $size: 0 } },
    })
        .select('_id name artists album genres')
        .lean();

    const albumMap = new Map();
    for (const track of tracks) {
        const artistKey = normalizeArtistKey(track.artists?.[0]);
        const albumKey = normalizeAlbumKey(track.album);
        if (!artistKey || !albumKey) continue;
        const key = `${artistKey}::${albumKey}`;
        if (!albumMap.has(key)) {
            albumMap.set(key, {
                artistKey,
                album: track.album,
                total: 0,
                tagged: 0,
                weights: new Map(),
                missing: [],
            });
        }
        const entry = albumMap.get(key);
        entry.total += 1;
        const genres = Array.isArray(track.genres) ? track.genres : [];
        if (!genres.length) {
            entry.missing.push(track);
            continue;
        }
        entry.tagged += 1;
        for (const genre of genres) {
            const token = normalizeGenreToken(genre);
            if (!token) continue;
            entry.weights.set(token, (entry.weights.get(token) || 0) + 1);
        }
    }

    let processed = 0;
    let updated = 0;
    let eligibleAlbums = 0;

    for (const entry of albumMap.values()) {
        if (processed >= LIMIT) break;
        if (!entry.missing.length || entry.tagged === 0) continue;
        const coverage = entry.tagged / entry.total;
        if (coverage < MIN_COVERAGE) continue;

        const genres = topGenresFromWeights(entry.weights, 5);
        if (!genres.length) continue;
        eligibleAlbums += 1;

        const remaining = LIMIT - processed;
        const targets = Number.isFinite(remaining)
            ? entry.missing.slice(0, Math.max(0, remaining))
            : entry.missing;
        if (!targets.length) continue;

        processed += targets.length;
        if (DRY_RUN) {
            console.log(`  [dry-run] "${entry.album}" -> [${genres.join(', ')}] for ${targets.length} track(s)`);
            updated += targets.length;
            continue;
        }

        const ids = targets.map((item) => item._id);
        const result = await Track.updateMany(
            {
                _id: { $in: ids },
                $or: [{ genres: { $exists: false } }, { genres: { $size: 0 } }],
            },
            {
                $set: {
                    genres,
                    primaryGenre: genres[0],
                    genreConfidence: 0.85,
                    'metadataSources.genre': 'album_propagation',
                    metadataUpdatedAt: new Date(),
                },
                $inc: { metadataAttempts: 1 },
            }
        );
        updated += result.modifiedCount || 0;
    }

    console.log('[propagateAlbumGenres] ─────────────────────────────');
    console.log(`[propagateAlbumGenres] Albums eligible : ${eligibleAlbums}`);
    console.log(`[propagateAlbumGenres] Processed tracks: ${processed}`);
    console.log(`[propagateAlbumGenres] Updated tracks  : ${updated}`);
    if (DRY_RUN) console.log('[propagateAlbumGenres] DRY RUN — no changes written');
    console.log('[propagateAlbumGenres] ─────────────────────────────');

    await mongoose.disconnect();
}

run().catch(async (err) => {
    console.error('[propagateAlbumGenres] Fatal error:', err.message);
    try { await mongoose.disconnect(); } catch (_) { /* noop */ }
    process.exit(1);
});
