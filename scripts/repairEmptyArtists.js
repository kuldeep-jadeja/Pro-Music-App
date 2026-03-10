/**
 * repairEmptyArtists.js — Re-fetch and repair tracks with empty artists[]
 *
 * Finds all Track documents where artists is an empty array,
 * fetches the correct metadata from Spotify using spotify-url-info,
 * and updates name, artists, album, albumImage, and fingerprint.
 *
 * Run with:  node scripts/repairEmptyArtists.js
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

// ─── Mongoose schema (worker-local, no @/ alias) ──────────────────────────────
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

// ─── Fingerprint helper (mirrors lib/trackFingerprint.js) ────────────────────
function generateFingerprint(name, artists) {
    let result = (name || '').toLowerCase();
    result = result.replace(/\([^)]*\)/g, '');
    result = result.replace(/\bfeat(?:uring)?\b/g, '');
    result = result.replace(/\bremaster(?:ed)?\b/g, '');
    result = result.replace(/[^\w\s]/g, '');
    result = result.trim().replace(/\s+/g, ' ');
    const primaryArtist = ((artists && artists[0]) || '')
        .toLowerCase()
        .replace(/[^\w\s]/g, '')
        .trim();
    return primaryArtist ? `${result} ${primaryArtist}`.trim() : result;
}

// ─── Spotify data parsers ─────────────────────────────────────────────────────
function parseArtists(input) {
    if (Array.isArray(input)) {
        return input
            .map(a => (typeof a === 'string' ? a : (a.name || a.title || '')))
            .filter(Boolean);
    }
    if (typeof input === 'string') return input.split(/\s*,\s*/).filter(Boolean);
    return [];
}

function extractImage(data) {
    if (!data) return null;
    if (data.album?.images?.[0]?.url) return data.album.images[0].url;
    if (Array.isArray(data.images) && data.images[0]?.url) return data.images[0].url;
    if (typeof data.image === 'string') return data.image;
    return null;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
    console.log('\n=== Repair: Empty Artists ===\n');

    await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 15_000 });
    console.log('Connected to MongoDB');

    const Track = mongoose.models.Track || mongoose.model('Track', TrackSchema);

    // Find all tracks with an empty artists array
    const broken = await Track.find({ artists: { $size: 0 } }).lean();
    console.log(`Found ${broken.length} track(s) with empty artists[]\n`);

    if (broken.length === 0) {
        console.log('Nothing to repair. All done.');
        await mongoose.disconnect();
        return;
    }

    // Load spotify-url-info (ESM package — requires dynamic import)
    let getData;
    try {
        const spotifyUrlInfo = await import('spotify-url-info');
        getData = spotifyUrlInfo.default(fetch).getData;
    } catch (err) {
        console.error('Failed to load spotify-url-info:', err.message);
        await mongoose.disconnect();
        process.exit(1);
    }

    let repaired = 0;
    let failed = 0;

    for (const track of broken) {
        const url = `https://open.spotify.com/track/${track.spotifyId}`;
        console.log(`→ Fetching: "${track.name}" (${track.spotifyId})`);

        try {
            const data = await getData(url);

            const artists = parseArtists(data.artists);
            const name = data.name || data.title || track.name;
            const album = data.album?.name || (typeof data.album === 'string' ? data.album : track.album) || null;
            const albumImage = extractImage(data) || track.albumImage || null;
            const fingerprint = generateFingerprint(name, artists);

            if (artists.length === 0) {
                console.warn(`  ✗ Spotify still returned no artists for this track — skipping`);
                failed++;
                continue;
            }

            await Track.updateOne(
                { _id: track._id },
                { $set: { name, artists, album, albumImage, fingerprint } }
            );

            console.log(`  ✓ Repaired → artists: [${artists.join(', ')}], album: ${album}`);
            repaired++;
        } catch (err) {
            console.error(`  ✗ Failed to fetch from Spotify: ${err.message}`);
            failed++;
        }

        // Brief pause to avoid rate-limiting
        await new Promise(r => setTimeout(r, 800));
    }

    console.log(`\n=== Done ===`);
    console.log(`  Repaired : ${repaired}`);
    console.log(`  Failed   : ${failed}`);

    await mongoose.disconnect();
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
