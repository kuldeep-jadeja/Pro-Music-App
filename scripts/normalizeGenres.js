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
    console.error('[normalizeGenres] MONGODB_URI not set');
    process.exit(1);
}

const CANONICAL_MAP = new Map([
    ['electronica', 'electronic'],
    ['electro', 'electronic'],
    ['edm', 'electronic'],
    ['electronic-music', 'electronic'],
    ['dance', 'electronic'],
    ['hip-hop', 'hip-hop'],
    ['hiphop', 'hip-hop'],
    ['hip-hop-rap', 'hip-hop'],
    ['rap', 'hip-hop'],
    ['trap', 'hip-hop'],
    ['poppunk', 'pop-punk'],
    ['pop-punk', 'pop-punk'],
    ['hard-rock', 'hard-rock'],
    ['rnb', 'r-and-b'],
    ['r-and-b', 'r-and-b'],
    ['rhythm-and-blues', 'r-and-b'],
    ['kpop', 'k-pop'],
    ['k-pop', 'k-pop'],
]);

const TrackSchema = new mongoose.Schema(
    {
        name: String,
        genres: { type: [String], default: [] },
        primaryGenre: { type: String, default: null },
        metadataUpdatedAt: { type: Date, default: null },
    },
    { timestamps: true }
);

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

function canonicalizeGenre(value) {
    const token = normalizeGenreToken(value);
    if (!token) return null;
    return CANONICAL_MAP.get(token) || token;
}

function normalizeGenreArray(values, max = 5) {
    const out = [];
    const seen = new Set();
    for (const value of values) {
        const canonical = canonicalizeGenre(value);
        if (!canonical || seen.has(canonical)) continue;
        seen.add(canonical);
        out.push(canonical);
        if (out.length >= max) break;
    }
    return out;
}

async function run() {
    if (DRY_RUN) console.log('[normalizeGenres] DRY RUN — no DB writes');
    if (LIMIT !== Infinity) console.log(`[normalizeGenres] Limit: ${LIMIT}`);

    await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 15_000 });
    const Track = mongoose.models.Track || mongoose.model('Track', TrackSchema);

    const tracks = await Track.find({
        genres: { $exists: true, $not: { $size: 0 } },
    })
        .select('_id name genres primaryGenre')
        .sort({ _id: 1 })
        .lean();

    let processed = 0;
    let updated = 0;

    for (const track of tracks) {
        if (processed >= LIMIT) break;
        processed++;

        const currentGenres = Array.isArray(track.genres) ? track.genres : [];
        const nextGenres = normalizeGenreArray(currentGenres, 5);
        if (!nextGenres.length) continue;

        const nextPrimaryFromCurrent = canonicalizeGenre(track.primaryGenre);
        const nextPrimary = nextPrimaryFromCurrent && nextGenres.includes(nextPrimaryFromCurrent)
            ? nextPrimaryFromCurrent
            : nextGenres[0];

        const changed =
            JSON.stringify(currentGenres) !== JSON.stringify(nextGenres) ||
            (track.primaryGenre || null) !== nextPrimary;
        if (!changed) continue;

        if (DRY_RUN) {
            console.log(
                `  [dry-run] "${track.name}" -> [${nextGenres.join(', ')}], primary=${nextPrimary}`
            );
            updated++;
            continue;
        }

        const result = await Track.updateOne(
            { _id: track._id },
            {
                $set: {
                    genres: nextGenres,
                    primaryGenre: nextPrimary,
                    metadataUpdatedAt: new Date(),
                },
            }
        );
        if (result.modifiedCount > 0) updated++;
    }

    console.log('[normalizeGenres] ─────────────────────────────');
    console.log(`[normalizeGenres] Processed : ${processed}`);
    console.log(`[normalizeGenres] Updated   : ${updated}`);
    if (DRY_RUN) console.log('[normalizeGenres] DRY RUN — no changes written');
    console.log('[normalizeGenres] ─────────────────────────────');

    await mongoose.disconnect();
}

run().catch(async (err) => {
    console.error('[normalizeGenres] Fatal error:', err.message);
    try { await mongoose.disconnect(); } catch (_) { /* noop */ }
    process.exit(1);
});
