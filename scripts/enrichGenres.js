/**
 * enrichGenres.js — Backfill Last.fm genre tags for existing tracks missing genres
 *
 * Queries Track documents where genres array is empty (or missing), calls Last.fm
 * track.getInfo for each, normalizes and writes genres/primaryGenre back to MongoDB.
 *
 * Features:
 *   - Batch cursor (BATCH_SIZE docs per MongoDB query — never loads full collection)
 *   - Last.fm rate-limited to 1 req / LASTFM_DELAY_MS (default 500ms)
 *   - Graceful SIGINT — finishes current batch, then exits cleanly
 *   - --dry-run flag — logs what would be written, no DB writes
 *   - --limit N flag — stop after N tracks processed (useful for testing)
 *   - Idempotent — skips tracks that already have genres
 *   - Never overwrites existing genre data (conditional $set)
 *
 * Run:
 *   node scripts/enrichGenres.js
 *   node scripts/enrichGenres.js --dry-run
 *   node scripts/enrichGenres.js --limit 50
 */

'use strict';

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

// ─── Load .env.local ──────────────────────────────────────────────────────────
(function loadEnvLocal() {
    if (process.env.MONGODB_URI) return;
    const envPath = path.resolve(__dirname, '..', '.env.local');
    if (!fs.existsSync(envPath)) { console.error('[enrichGenres] Missing .env.local'); process.exit(1); }
    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx === -1) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim();
        if (!process.env[key]) process.env[key] = val;
    }
}());

// ─── Config ───────────────────────────────────────────────────────────────────
const MONGODB_URI = process.env.MONGODB_URI;
const LASTFM_API_KEY = process.env.LASTFM_API_KEY;
const BATCH_SIZE = 100;           // tracks fetched per MongoDB query
const LASTFM_DELAY_MS = 550;      // ~1 req/s with buffer (Last.fm soft limit)
const LASTFM_TIMEOUT_MS = 9000;

// ─── CLI flags ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const limitIdx = args.indexOf('--limit');
const LIMIT = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : Infinity;

if (!MONGODB_URI) { console.error('[enrichGenres] MONGODB_URI not set'); process.exit(1); }
if (!LASTFM_API_KEY) { console.error('[enrichGenres] LASTFM_API_KEY not set — add it to .env.local'); process.exit(1); }
if (DRY_RUN) console.log('[enrichGenres] DRY RUN — no DB writes');
if (LIMIT !== Infinity) console.log(`[enrichGenres] Limit: ${LIMIT} tracks`);

// ─── Mongoose schema ──────────────────────────────────────────────────────────
const TrackSchema = new mongoose.Schema(
    {
        name: String,
        artists: [String],
        spotifyId: String,
        genres: { type: [String], default: [] },
        primaryGenre: { type: String, default: null },
        genreConfidence: { type: Number, default: null },
        metadataSources: { genre: String, album: String },
        metadataUpdatedAt: { type: Date, default: null },
        metadataAttempts: { type: Number, default: 0 },
    },
    { timestamps: true }
);

// ─── Helpers ──────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function normalizeGenreToken(value) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim().toLowerCase();
    if (!trimmed) return null;
    const slug = trimmed
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/&/g, ' and ')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return slug || null;
}

function normalizeGenres(input) {
    const source = Array.isArray(input) ? input : [input];
    const deduped = [];
    const seen = new Set();
    for (const item of source) {
        const normalized = normalizeGenreToken(item);
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        deduped.push(normalized);
        if (deduped.length >= 5) break;
    }
    return deduped;
}

// ─── Last.fm fetch ────────────────────────────────────────────────────────────
async function fetchLastfmGenres(artist, trackName) {
    const url =
        `https://ws.audioscrobbler.com/2.0/?method=track.getInfo` +
        `&api_key=${LASTFM_API_KEY}` +
        `&artist=${encodeURIComponent(artist)}` +
        `&track=${encodeURIComponent(trackName)}` +
        `&format=json&autocorrect=1`;

    try {
        const res = await fetch(url, { signal: AbortSignal.timeout(LASTFM_TIMEOUT_MS) });
        if (!res.ok) return null;
        const json = await res.json();
        if (json.error) return null;

        const tags = json.track?.toptags?.tag;
        if (!Array.isArray(tags) || tags.length === 0) return null;

        return tags
            .map(t => (typeof t.name === 'string' ? t.name.trim() : ''))
            .filter(Boolean)
            .slice(0, 5);
    } catch (_err) {
        return null;
    }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function run() {
    console.log('[enrichGenres] Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 15_000 });
    console.log('[enrichGenres] Connected');

    const Track = mongoose.models.Track || mongoose.model('Track', TrackSchema);

    // Count total work upfront
    const totalMissing = await Track.countDocuments({
        $or: [
            { genres: { $exists: false } },
            { genres: { $size: 0 } },
        ],
    });
    console.log(`[enrichGenres] Tracks missing genres: ${totalMissing}`);
    if (totalMissing === 0) {
        console.log('[enrichGenres] Nothing to do.');
        await mongoose.disconnect();
        return;
    }

    // Graceful shutdown
    let stopping = false;
    process.on('SIGINT', () => {
        console.log('\n[enrichGenres] SIGINT received — finishing current batch then stopping...');
        stopping = true;
    });

    let offset = 0;
    let processed = 0;
    let enriched = 0;
    let skipped = 0;
    let failed = 0;

    while (!stopping) {
        if (processed >= LIMIT) {
            console.log(`[enrichGenres] Limit of ${LIMIT} reached — stopping`);
            break;
        }

        // Fetch next batch
        const batch = await Track.find({
            $or: [
                { genres: { $exists: false } },
                { genres: { $size: 0 } },
            ],
        })
            .select('_id name artists spotifyId metadataAttempts')
            .sort({ _id: 1 })
            .skip(offset)
            .limit(BATCH_SIZE)
            .lean();

        if (batch.length === 0) break;

        console.log(`[enrichGenres] Batch ${Math.floor(offset / BATCH_SIZE) + 1}: ${batch.length} tracks`);

        for (const track of batch) {
            if (stopping || processed >= LIMIT) break;

            const artist = track.artists?.[0] || '';
            const name = track.name || '';

            if (!artist || !name) {
                skipped++;
                processed++;
                continue;
            }

            const rawTags = await fetchLastfmGenres(artist, name);

            if (!rawTags || rawTags.length === 0) {
                console.log(`  [skip] "${name}" — no Last.fm tags`);
                failed++;
                processed++;
                await sleep(LASTFM_DELAY_MS);
                continue;
            }

            const genres = normalizeGenres(rawTags);
            const primaryGenre = genres[0];

            if (DRY_RUN) {
                console.log(`  [dry-run] "${name}" → genres: [${genres.join(', ')}]`);
            } else {
                await Track.updateOne(
                    {
                        _id: track._id,
                        // Only write if genres still empty (guard against concurrent writes)
                        $or: [
                            { genres: { $exists: false } },
                            { genres: { $size: 0 } },
                        ],
                    },
                    {
                        $set: {
                            genres,
                            primaryGenre,
                            'metadataSources.genre': 'lastfm',
                            metadataUpdatedAt: new Date(),
                        },
                        $inc: { metadataAttempts: 1 },
                    }
                );
                console.log(`  [ok] "${name}" → [${genres.join(', ')}]`);
            }

            enriched++;
            processed++;
            await sleep(LASTFM_DELAY_MS);
        }

        // If batch was smaller than BATCH_SIZE, we've exhausted the cursor
        if (batch.length < BATCH_SIZE) break;

        // Advance offset — but since we're updating docs (removing them from the
        // query filter), re-query from offset 0 each batch to avoid skipping docs.
        // Only advance offset when in dry-run (no docs removed from result set).
        if (DRY_RUN) offset += BATCH_SIZE;
    }

    console.log('');
    console.log('[enrichGenres] ─────────────────────────────');
    console.log(`[enrichGenres] Processed : ${processed}`);
    console.log(`[enrichGenres] Enriched  : ${enriched}`);
    console.log(`[enrichGenres] No tags   : ${failed}`);
    console.log(`[enrichGenres] Skipped   : ${skipped} (missing artist/name)`);
    if (DRY_RUN) console.log('[enrichGenres] DRY RUN — no changes written');
    console.log('[enrichGenres] ─────────────────────────────');

    await mongoose.disconnect();
    process.exit(0);
}

run().catch(err => {
    console.error('[enrichGenres] Fatal error:', err.message);
    process.exit(1);
});
