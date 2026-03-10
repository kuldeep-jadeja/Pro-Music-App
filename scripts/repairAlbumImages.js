/**
 * repairAlbumImages.js — Backfill missing album and albumImage for existing tracks
 *
 * Finds all Track documents where albumImage is null OR album is "Unknown Album",
 * re-fetches the individual Spotify track page, and writes the real values back.
 *
 * Run with:  node scripts/repairAlbumImages.js
 *
 * Safe to run multiple times — only updates tracks that are still missing data.
 * Rate-limited to ~1 request/sec to stay within Spotify's public embed limits.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

// ─── Load .env.local ──────────────────────────────────────────────────────────
(function loadEnvLocal() {
    if (process.env.MONGODB_URI) return;
    const envPath = path.resolve(__dirname, '..', '.env.local');
    if (!fs.existsSync(envPath)) { console.error('Missing .env.local'); process.exit(1); }
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

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }

// Delay between Spotify requests (ms) — avoids rate-limiting
const REQUEST_DELAY_MS = 1000;

// ─── Mongoose schema ──────────────────────────────────────────────────────────
const TrackSchema = new mongoose.Schema(
    {
        name: String,
        artists: [String],
        album: String,
        duration: Number,
        spotifyId: { type: String, unique: true },
        youtubeVideoId: { type: String, default: null },
        albumImage: String,
        fingerprint: String,
        importedAt: Date,
    },
    { timestamps: true }
);

// ─── Spotify data helpers ─────────────────────────────────────────────────────
function delay(ms) {
    return new Promise(r => setTimeout(r, ms));
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
    console.log('\n=== Repair: Album & Album Image ===\n');

    await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 15_000 });
    console.log('Connected to MongoDB');

    const Track = mongoose.models.Track || mongoose.model('Track', TrackSchema);

    // Find tracks missing albumImage OR with placeholder album name
    const broken = await Track.find({
        $or: [
            { albumImage: null },
            { albumImage: { $exists: false } },
            { album: 'Unknown Album' },
        ],
    }).lean();

    console.log(`Found ${broken.length} track(s) missing album/albumImage\n`);

    if (broken.length === 0) {
        console.log('Nothing to repair. All done.');
        await mongoose.disconnect();
        return;
    }

    // Load spotify-url-info (ESM — dynamic import required)
    // getPreview() is designed for individual tracks → returns { title, artist, image }
    // Note: getData() returns empty {} for track URLs, so album name can't be recovered
    // without official Spotify API credentials. We focus on fixing albumImage here.
    let getPreview;
    try {
        const spotifyUrlInfo = await import('spotify-url-info');
        getPreview = spotifyUrlInfo.default(fetch).getPreview;
    } catch (err) {
        console.error('Failed to load spotify-url-info:', err.message);
        await mongoose.disconnect();
        process.exit(1);
    }

    let repaired = 0;
    let skipped = 0;
    let failed = 0;

    for (let i = 0; i < broken.length; i++) {
        const track = broken[i];
        const url = `https://open.spotify.com/track/${track.spotifyId}`;
        process.stdout.write(`[${i + 1}/${broken.length}] "${track.name}" ... `);

        try {
            // getPreview returns { title, artist, image } for individual track URLs
            const preview = await getPreview(url);
            const albumImage = (preview?.image && typeof preview.image === 'string')
                ? preview.image
                : null;

            if (!albumImage) {
                console.log('no image returned — skipping');
                skipped++;
                await delay(REQUEST_DELAY_MS);
                continue;
            }

            await Track.updateOne({ _id: track._id }, { $set: { albumImage } });
            console.log('albumImage: ✓');
            repaired++;
        } catch (err) {
            console.log(`ERROR: ${err.message}`);
            failed++;
        }

        await delay(REQUEST_DELAY_MS);
    }

    console.log(`\n=== Done ===`);
    console.log(`  Repaired : ${repaired}`);
    console.log(`  Skipped  : ${skipped}  (Spotify returned no data)`);
    console.log(`  Failed   : ${failed}   (network/parse errors)`);

    await mongoose.disconnect();
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
