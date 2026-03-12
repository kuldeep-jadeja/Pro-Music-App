/**
 * repairMissingFields.js  —  Full 3-tier enrichment repair for existing tracks
 *
 * Finds every Track document that is missing album name or albumImage, then
 * runs the same 3-tier pipeline the workers now use:
 *
 *   Tier 1  iTunes Search API      (fast, concurrent, high mainstream coverage)
 *   Tier 2  Spotify OG scrape      (og:image + og:description for album name)
 *   Tier 3  MusicBrainz + CAA      (last resort, serialised 1 req/s)
 *
 * After enrichment each track is written back to MongoDB with a bulk-write.
 *
 * Safe to run multiple times — only touches tracks still missing data.
 *
 *   node scripts/repairMissingFields.js
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
    const raw = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    for (const line of raw) {
        const t = line.trim();
        if (!t || t.startsWith('#')) continue;
        const eqIdx = t.indexOf('=');
        if (eqIdx === -1) continue;
        const key = t.slice(0, eqIdx).trim();
        const val = t.slice(eqIdx + 1).trim();
        if (!process.env[key]) process.env[key] = val;
    }
}());

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }

// ─── Mongoose schema (mirrors models/Track.js) ────────────────────────────────
const TrackSchema = new mongoose.Schema(
    {
        name: String,
        artists: [String],
        album: String,
        duration: Number,
        spotifyId: { type: String, unique: true },
        youtubeVideoId: { type: String, default: null },
        albumImage: String,
        importedAt: Date,
    },
    { timestamps: true }
);

// ─── Helpers ──────────────────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─── Tier 1: iTunes Search API ────────────────────────────────────────────────
//
// Tries cleaned-up track name (feat./version suffixes stripped) first, then
// falls back to the original name.  Treats 403 as a rate-limit and bails out
// rather than wasting time retrying — callers should wait and re-run.

/** Strip featured-artist / version tags that confuse search engines. */
function cleanTrackName(name) {
    return name
        .replace(/\s*[\(\[](feat|ft|with|prod)[^\)\]]*[\)\]]/gi, '')
        .replace(/\s*-\s*(radio|acoustic|live|demo|remix|remaster(?:ed)?|version|edit|extended|alt(?:ernate)?).*$/gi, '')
        .replace(/\s*\([^)]*\)\s*$/, '') // trailing parenthetical
        .trim();
}

async function fetchFromItunes(track) {
    const MAX_RETRIES = 3;
    const artist = track.artists?.[0] || '';
    const cleanName = cleanTrackName(track.name);
    const queries = cleanName !== track.name
        ? [`${artist} ${cleanName}`, `${artist} ${track.name}`]
        : [`${artist} ${track.name}`];

    for (const queryStr of queries) {
        const url = `https://itunes.apple.com/search?term=${encodeURIComponent(queryStr)}&media=music&entity=song&limit=1&country=US`;
        let attempt = 0;
        while (attempt < MAX_RETRIES) {
            try {
                const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
                if (res.status === 403) {
                    // Apple has rate-limited this IP — abort iTunes entirely
                    console.warn('  [iTunes] 403 rate-limit hit — skipping iTunes tier for this run');
                    return false;
                }
                if (res.status === 429 || res.status >= 500) {
                    await sleep(500 * Math.pow(2, attempt));
                    attempt++;
                    continue;
                }
                if (!res.ok) break; // non-retryable → try next query string
                const body = await res.text();
                if (!body) break;   // empty body (transient) → try next query string
                const json = JSON.parse(body);
                const result = json.results?.[0];
                if (!result) break; // no match → try next query string
                if (!track.album || track.album === 'Unknown Album')
                    track.album = result.collectionName || track.album;
                if (!track.albumImage && result.artworkUrl100)
                    track.albumImage = result.artworkUrl100.replace('100x100bb', '600x600bb');
                return !!(track.album && track.albumImage);
            } catch (err) {
                if (attempt < MAX_RETRIES - 1) await sleep(500 * Math.pow(2, attempt));
                attempt++;
            }
        }
    }
    return false;
}

// NOTE: Spotify OG scrape (was Tier 2) removed — Spotify now serves a full
//       Next.js SPA shell with no server-rendered OG meta tags.

// ─── Tier 2: Deezer ──────────────────────────────────────────────────────────
// Free, no API key required. Returns album title + cover art in a single call.
async function fetchFromDeezer(track) {
    const artist = track.artists?.[0] || '';
    const cleanName = cleanTrackName(track.name);
    const queries = cleanName !== track.name
        ? [`${artist} ${cleanName}`, `${artist} ${track.name}`]
        : [`${artist} ${track.name}`];

    for (const queryStr of queries) {
        const url = `https://api.deezer.com/search?q=${encodeURIComponent(queryStr)}&limit=5`;
        try {
            const res = await fetch(url, {
                signal: AbortSignal.timeout(8000),
                headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
            });
            if (!res.ok) continue;
            const json = await res.json();

            // Deezer silent rate-limit: HTTP 200 but data:[] with total>0.
            // Bail out immediately — the window typically clears in a few minutes.
            if (json.data?.length === 0 && (json.total ?? 0) > 0) {
                console.warn('  [Deezer] Silent rate-limit detected — skipping Deezer tier for this run');
                return false;
            }

            const hit = json.data?.[0];
            if (!hit) continue;

            if (!track.album || track.album === 'Unknown Album') {
                track.album = hit.album?.title || track.album;
            }
            if (!track.albumImage && hit.album?.cover_xl) {
                track.albumImage = hit.album.cover_xl;
            } else if (!track.albumImage && hit.album?.cover_medium) {
                track.albumImage = hit.album.cover_medium;
            }

            if (track.album && track.album !== 'Unknown Album' && track.albumImage) return true;
        } catch (err) {
            // non-fatal — move on to next query
        }
    }
    return !!(track.album && track.album !== 'Unknown Album' && track.albumImage);
}

// ─── Tier 3: MusicBrainz + CoverArtArchive ───────────────────────────────────
async function fetchFromMusicBrainz(track) {
    const artist = track.artists?.[0] || '';
    // Use cleaned name so "Song (feat. X)" → "Song" matches in MusicBrainz
    const cleanedName = cleanTrackName(track.name);
    const query = encodeURIComponent(`recording:"${cleanedName}" AND artist:"${artist}"`);
    const headers = { 'User-Agent': 'ProMusicApp/1.0 (https://github.com/pro-music-app)' };
    try {
        const res = await fetch(
            `https://musicbrainz.org/ws/2/recording/?query=${query}&fmt=json&limit=10&inc=releases+release-groups`,
            { signal: AbortSignal.timeout(12000), headers }
        );
        if (!res.ok) return false;
        const json = await res.json();

        let bestRelease = null;
        for (const recording of json.recordings?.slice(0, 5) ?? []) {
            const releases = recording.releases ?? [];
            const candidate =
                releases.find(r =>
                    r.status === 'Official' &&
                    r['release-group']?.['primary-type'] === 'Album' &&
                    !(r['release-group']?.['secondary-types'] ?? []).some(s =>
                        ['Live', 'Compilation', 'Soundtrack', 'Remix'].includes(s))
                ) ||
                releases.find(r => r.status === 'Official' && r['release-group']?.['primary-type'] === 'Album') ||
                releases.find(r => r.status === 'Official') ||
                releases[0];
            if (candidate && candidate.status !== 'Bootleg') { bestRelease = candidate; break; }
        }
        if (!bestRelease) return false;

        if (!track.album || track.album === 'Unknown Album')
            track.album = bestRelease.title || track.album;

        if (!track.albumImage && bestRelease.id) {
            try {
                const caaRes = await fetch(
                    `https://coverartarchive.org/release/${bestRelease.id}`,
                    { signal: AbortSignal.timeout(8000), headers }
                );
                if (caaRes.ok) {
                    const caaJson = await caaRes.json();
                    const img = caaJson.images?.find(i => i.front) || caaJson.images?.[0];
                    if (img) track.albumImage = img.thumbnails?.['500'] || img.thumbnails?.large || img.image || null;
                }
            } catch (_) { /* non-fatal */ }
        }
        return !!(track.album && track.albumImage);
    } catch (err) {
        return false;
    }
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────
async function enrichBatch(tracks) {
    // Tier 1 — iTunes (5 concurrent, 300 ms between batches)
    for (let i = 0; i < tracks.length; i += 5) {
        await Promise.all(tracks.slice(i, i + 5).map(fetchFromItunes));
        if (i + 5 < tracks.length) await sleep(300);
    }

    const afterItunes = tracks.filter(t => !t.albumImage || !t.album || t.album === 'Unknown Album');
    if (afterItunes.length === 0) return;
    console.log(`  iTunes resolved ${tracks.length - afterItunes.length}/${tracks.length} — ${afterItunes.length} still need work`);

    // Tier 2 — Deezer (5 concurrent, 300 ms between batches, no API key)
    for (let i = 0; i < afterItunes.length; i += 5) {
        await Promise.all(afterItunes.slice(i, i + 5).map(fetchFromDeezer));
        if (i + 5 < afterItunes.length) await sleep(300);
    }

    const afterDeezer = afterItunes.filter(t => !t.albumImage || !t.album || t.album === 'Unknown Album');
    if (afterDeezer.length === 0) {
        console.log(`  Deezer resolved all ${afterItunes.length} remaining tracks`);
        return;
    }
    console.log(`  Deezer resolved ${afterItunes.length - afterDeezer.length}/${afterItunes.length} — ${afterDeezer.length} still need work`);

    // Tier 3 — MusicBrainz (serialised, 1100 ms apart)
    for (let i = 0; i < afterDeezer.length; i++) {
        await fetchFromMusicBrainz(afterDeezer[i]);
        if (i < afterDeezer.length - 1) await sleep(1100);
    }
    const afterMB = afterDeezer.filter(t => !t.albumImage || !t.album || t.album === 'Unknown Album');
    console.log(`  MusicBrainz resolved ${afterDeezer.length - afterMB.length}/${afterDeezer.length} — ${afterMB.length} still unresolved`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
    console.log('\n=== Repair: Missing album / albumImage (3-tier enrichment) ===\n');

    await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 15_000 });
    console.log('Connected to MongoDB\n');

    const Track = mongoose.models.Track || mongoose.model('Track', TrackSchema);

    // ── Pre-repair DB summary ──────────────────────────────────────────────────
    const total = await Track.countDocuments();
    const noAlbum = await Track.countDocuments({ $or: [{ album: null }, { album: '' }, { album: 'Unknown Album' }] });
    const noImage = await Track.countDocuments({ $or: [{ albumImage: null }, { albumImage: { $exists: false } }, { albumImage: '' }] });
    const noYT = await Track.countDocuments({ $or: [{ youtubeVideoId: null }, { youtubeVideoId: { $exists: false } }] });
    const noArtist = await Track.countDocuments({ $or: [{ artists: [] }, { artists: { $exists: false } }] });

    console.log('── Before repair ────────────────────────────────────────');
    console.log(`  Total tracks       : ${total}`);
    console.log(`  Missing album name : ${noAlbum}`);
    console.log(`  Missing albumImage : ${noImage}`);
    console.log(`  Missing youtubeId  : ${noYT}  (handled by ytMatchWorker — skipped here)`);
    console.log(`  Missing artists[]  : ${noArtist}`);
    console.log('─────────────────────────────────────────────────────────\n');

    // ── Load tracks that need metadata enrichment ─────────────────────────────
    const toEnrich = await Track.find({
        $or: [
            { albumImage: null },
            { albumImage: { $exists: false } },
            { albumImage: '' },
            { album: null },
            { album: '' },
            { album: 'Unknown Album' },
        ],
    }).lean();

    if (toEnrich.length === 0) {
        console.log('Nothing to enrich — all tracks have album and albumImage.');
    } else {
        console.log(`Found ${toEnrich.length} track(s) to enrich\n`);

        // Work in batches of 50 so we can flush bulk-writes periodically
        const BATCH = 50;
        let totalRepaired = 0;

        for (let start = 0; start < toEnrich.length; start += BATCH) {
            const batch = toEnrich.slice(start, start + BATCH);
            const end = Math.min(start + BATCH, toEnrich.length);
            console.log(`\n[Batch ${Math.ceil((start + 1) / BATCH)}] Processing tracks ${start + 1}–${end} of ${toEnrich.length}...`);

            // Snapshot what was missing before enrichment
            const before = batch.map(t => ({ album: t.album, albumImage: t.albumImage }));

            await enrichBatch(batch);

            // Build bulk-write operations for tracks that changed
            const ops = [];
            for (let i = 0; i < batch.length; i++) {
                const t = batch[i];
                const b = before[i];
                const albumChanged = t.album && t.album !== b.album;
                const imageChanged = t.albumImage && t.albumImage !== b.albumImage;
                if (!albumChanged && !imageChanged) continue;

                const setFields = {};
                if (albumChanged) setFields.album = t.album;
                if (imageChanged) setFields.albumImage = t.albumImage;

                ops.push({
                    updateOne: {
                        filter: { _id: t._id },
                        update: { $set: setFields },
                    },
                });
            }

            if (ops.length > 0) {
                await Track.bulkWrite(ops, { ordered: false });
                totalRepaired += ops.length;
                console.log(`  ✔ Wrote ${ops.length} update(s) to MongoDB`);
            } else {
                console.log('  — No changes for this batch');
            }
        }

        console.log(`\n── Enrichment complete: ${totalRepaired} track(s) updated ──`);
    }

    // ── Post-repair DB summary ─────────────────────────────────────────────────
    const noAlbumAfter = await Track.countDocuments({ $or: [{ album: null }, { album: '' }, { album: 'Unknown Album' }] });
    const noImageAfter = await Track.countDocuments({ $or: [{ albumImage: null }, { albumImage: { $exists: false } }, { albumImage: '' }] });

    console.log('\n── After repair ─────────────────────────────────────────');
    console.log(`  Total tracks       : ${total}`);
    console.log(`  Missing album name : ${noAlbumAfter}  (was ${noAlbum})`);
    console.log(`  Missing albumImage : ${noImageAfter}  (was ${noImage})`);
    console.log('─────────────────────────────────────────────────────────\n');

    await mongoose.disconnect();
    console.log('Done.\n');
}

main().catch(err => {
    console.error('\nFatal error:', err.message);
    process.exit(1);
});
