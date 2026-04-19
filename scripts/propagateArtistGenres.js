/**
 * propagateArtistGenres.js — Fill missing track genres from known artist genres.
 *
 * Uses existing Track data only (no external API calls):
 * - Build artist -> top genres map from tracks that already have genres
 * - Apply to tracks missing genres using first listed artist
 *
 * Run:
 *   node scripts/propagateArtistGenres.js
 *   node scripts/propagateArtistGenres.js --dry-run
 *   node scripts/propagateArtistGenres.js --limit 500
 */

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

if (!MONGODB_URI) {
    console.error('[propagateGenres] MONGODB_URI not set');
    process.exit(1);
}

const TrackSchema = new mongoose.Schema(
    {
        name: String,
        artists: [String],
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

function mergeTopGenres(source, max = 5) {
    const out = [];
    const seen = new Set();
    for (const value of source) {
        const token = normalizeGenreToken(value);
        if (!token || seen.has(token)) continue;
        seen.add(token);
        out.push(token);
        if (out.length >= max) break;
    }
    return out;
}

async function run() {
    if (DRY_RUN) console.log('[propagateGenres] DRY RUN — no DB writes');
    if (LIMIT !== Infinity) console.log(`[propagateGenres] Limit: ${LIMIT}`);

    await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 15_000 });
    const Track = mongoose.models.Track || mongoose.model('Track', TrackSchema);

    // Build artist -> weighted genre map from already tagged tracks.
    const taggedTracks = await Track.find({
        genres: { $exists: true, $not: { $size: 0 } },
        artists: { $exists: true, $not: { $size: 0 } },
    })
        .select('artists genres')
        .lean();

    const artistGenreWeights = new Map();
    for (const track of taggedTracks) {
        const artistKey = normalizeArtistKey(track.artists?.[0]);
        if (!artistKey) continue;
        if (!artistGenreWeights.has(artistKey)) artistGenreWeights.set(artistKey, new Map());
        const weights = artistGenreWeights.get(artistKey);
        for (const genre of Array.isArray(track.genres) ? track.genres : []) {
            const token = normalizeGenreToken(genre);
            if (!token) continue;
            weights.set(token, (weights.get(token) || 0) + 1);
        }
    }

    const artistGenreMap = new Map();
    for (const [artistKey, weights] of artistGenreWeights.entries()) {
        const topGenres = [...weights.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([genre]) => genre)
            .slice(0, 5);
        if (topGenres.length) artistGenreMap.set(artistKey, topGenres);
    }

    console.log(`[propagateGenres] Artists with known genres: ${artistGenreMap.size}`);

    const missingTracks = await Track.find({
        $or: [{ genres: { $exists: false } }, { genres: { $size: 0 } }],
        artists: { $exists: true, $not: { $size: 0 } },
    })
        .select('_id name artists')
        .sort({ _id: 1 })
        .lean();

    let processed = 0;
    let updated = 0;
    let noMatch = 0;

    for (const track of missingTracks) {
        if (processed >= LIMIT) break;
        processed++;

        const artistKey = normalizeArtistKey(track.artists?.[0]);
        if (!artistKey) {
            noMatch++;
            continue;
        }

        const genres = artistGenreMap.get(artistKey);
        if (!genres?.length) {
            noMatch++;
            continue;
        }

        const finalGenres = mergeTopGenres(genres, 5);
        if (!finalGenres.length) {
            noMatch++;
            continue;
        }

        if (DRY_RUN) {
            console.log(`  [dry-run] "${track.name}" -> [${finalGenres.join(', ')}]`);
            updated++;
            continue;
        }

        const result = await Track.updateOne(
            {
                _id: track._id,
                $or: [{ genres: { $exists: false } }, { genres: { $size: 0 } }],
            },
            {
                $set: {
                    genres: finalGenres,
                    primaryGenre: finalGenres[0],
                    genreConfidence: 0.6,
                    'metadataSources.genre': 'artist_propagation',
                    metadataUpdatedAt: new Date(),
                },
                $inc: { metadataAttempts: 1 },
            }
        );
        if (result.modifiedCount > 0) updated++;
    }

    console.log('[propagateGenres] ─────────────────────────────');
    console.log(`[propagateGenres] Processed : ${processed}`);
    console.log(`[propagateGenres] Updated   : ${updated}`);
    console.log(`[propagateGenres] No match  : ${noMatch}`);
    if (DRY_RUN) console.log('[propagateGenres] DRY RUN — no changes written');
    console.log('[propagateGenres] ─────────────────────────────');

    await mongoose.disconnect();
}

run().catch(async (err) => {
    console.error('[propagateGenres] Fatal error:', err.message);
    try { await mongoose.disconnect(); } catch (_) { /* noop */ }
    process.exit(1);
});
