'use strict';

/**
 * workers/lib/enrichment.js — Shared multi-tier metadata enrichment
 *
 * Fills missing `album` and `albumImage` on track objects using a waterfall
 * of public APIs.  Each tier is attempted only on tracks still missing data
 * after the previous tier — API calls are never wasted on complete records.
 *
 * Tier chain (in order):
 *   1. iTunes Search API    — fast, concurrent (5 at a time), great mainstream coverage
 *   2. Deezer API           — no auth, good international/non-mainstream coverage
 *   3. TheAudioDB           — free key, covers gaps in iTunes + Deezer
 *   4. Last.fm              — optional (requires LASTFM_API_KEY env), also extracts genre tags
 *   5. MusicBrainz + CAA    — last resort, strict 1 req/s rate limit
 *
 * Each tier function:
 *   - Accepts a single track object (mutates album / albumImage / _enrichSource in place)
 *   - Returns true if BOTH album AND albumImage are now present, false otherwise
 *   - Never throws — errors are logged as warnings and return false
 *
 * Exported:
 *   enrichTracks(tracks, tag)  — orchestrates all tiers; filters after each
 */

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const isDev = process.env.NODE_ENV !== 'production';

function logWarn(tag, msg) {
    console.warn(`[${tag}] WARN ${msg}`);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Strip feat/remix/version tokens that confuse music search engines. */
function cleanTrackName(name) {
    return name
        .replace(/\s*[\(\[](feat|ft|with|prod)[^\)\]]*[\)\]]/gi, '')
        .replace(/\s*-\s*(radio|acoustic|live|demo|remix|remaster(?:ed)?|version|edit|extended|alt(?:ernate)?).*$/gi, '')
        .replace(/\s*\([^)]*\)\s*$/, '')
        .trim();
}

function needsEnrichment(track) {
    return !track.albumImage || !track.album || track.album === 'Unknown Album';
}

// ── Tier 1: iTunes Search API ─────────────────────────────────────────────────
// Fast concurrent requests. Best coverage for mainstream Western catalog.
// Tries cleaned track name first (strips feat./version), falls back to full name.

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
                    console.warn('[enrichment] iTunes 403 — rate-limited, skipping iTunes tier');
                    return false;
                }
                if (res.status === 429 || res.status >= 500) {
                    await sleep(500 * Math.pow(2, attempt));
                    attempt++;
                    continue;
                }
                if (!res.ok) break;
                const body = await res.text();
                if (!body) break;
                const json = JSON.parse(body);
                const result = json.results?.[0];
                if (!result) break;
                if (!track.album || track.album === 'Unknown Album')
                    track.album = result.collectionName || track.album;
                if (!track.albumImage && result.artworkUrl100)
                    track.albumImage = result.artworkUrl100.replace('100x100bb', '600x600bb');
                if (track.album && track.albumImage) {
                    track._enrichSource = 'itunes';
                    return true;
                }
                break;
            } catch (_err) {
                if (attempt < MAX_RETRIES - 1) await sleep(500 * Math.pow(2, attempt));
                attempt++;
            }
        }
    }

    return !!(track.album && track.albumImage);
}

// ── Tier 2: Deezer API ────────────────────────────────────────────────────────
// No API key required. Better non-US / non-mainstream coverage than iTunes.
// Tries strict artist+track query first, then looser fallback.
// Bonus: fills missing duration (Deezer returns seconds → converted to ms).

async function fetchFromDeezer(track) {
    const artist = track.artists?.[0] || '';
    const name = track.name || '';
    if (!artist && !name) return false;

    const cleanName = cleanTrackName(name);
    const queries = [
        `artist:"${artist}" track:"${cleanName !== name ? cleanName : name}"`,
        `${artist} ${name}`,
    ];

    for (const q of queries) {
        try {
            const url = `https://api.deezer.com/search?q=${encodeURIComponent(q)}&limit=3`;
            const res = await fetch(url, { signal: AbortSignal.timeout(9000) });
            if (!res.ok) continue;
            const json = await res.json();
            const hit = json.data?.[0];
            if (!hit) continue;

            if (!track.album || track.album === 'Unknown Album') {
                track.album = hit.album?.title || track.album;
            }
            if (!track.albumImage) {
                track.albumImage =
                    hit.album?.cover_xl ||
                    hit.album?.cover_big ||
                    hit.album?.cover_medium ||
                    null;
            }
            // Bonus: fill missing duration (Deezer = seconds, track.duration = ms)
            if (!track.duration && hit.duration) {
                track.duration = hit.duration * 1000;
            }

            if (track.album && track.albumImage) {
                track._enrichSource = 'deezer';
                return true;
            }
            // Partial hit — try next query
        } catch (_err) {
            break; // network error — skip Deezer entirely
        }
    }

    return !!(track.album && track.albumImage);
}

// ── Tier 3: TheAudioDB ────────────────────────────────────────────────────────
// Free public key ("2") covers most catalog. Has artist images + mood/genre.
// Override with THEAUDIODB_API_KEY env var for Patreon key.

const THEAUDIODB_KEY = process.env.THEAUDIODB_API_KEY || '2';

async function fetchFromTheAudioDB(track) {
    const artist = track.artists?.[0] || '';
    const name = track.name || '';
    if (!artist || !name) return false;

    // Try cleaned name first, then full name
    const names = [cleanTrackName(name), name].filter((v, i, arr) => arr.indexOf(v) === i);

    for (const trackName of names) {
        try {
            const url = `https://www.theaudiodb.com/api/v1/json/${THEAUDIODB_KEY}/searchtrack.php` +
                `?s=${encodeURIComponent(artist)}&t=${encodeURIComponent(trackName)}`;
            const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
            if (!res.ok) continue;
            const json = await res.json();
            const hit = json.track?.[0];
            if (!hit) continue;

            if (!track.album || track.album === 'Unknown Album') {
                track.album = hit.strAlbum || track.album;
            }
            if (!track.albumImage) {
                // Prefer track thumbnail, fall back to album thumbnail
                track.albumImage = hit.strTrackThumb || hit.strAlbumThumb || null;
            }

            if (track.album && track.albumImage) {
                track._enrichSource = 'theaudiodb';
                return true;
            }
        } catch (_err) {
            break;
        }
    }

    return !!(track.album && track.albumImage);
}

// ── Tier 4: Last.fm ───────────────────────────────────────────────────────────
// Requires LASTFM_API_KEY env var — skipped silently if not configured.
// Also extracts up to 5 genre tags into track._lastfmTags for callers to use.
// Autocorrect enabled (handles minor spelling variants).

async function fetchFromLastfm(track) {
    const key = process.env.LASTFM_API_KEY;
    if (!key) return false;

    const artist = track.artists?.[0] || '';
    const name = track.name || '';
    if (!artist || !name) return false;

    try {
        const url = `https://ws.audioscrobbler.com/2.0/?method=track.getInfo` +
            `&api_key=${key}` +
            `&artist=${encodeURIComponent(artist)}` +
            `&track=${encodeURIComponent(name)}` +
            `&format=json&autocorrect=1`;
        const res = await fetch(url, { signal: AbortSignal.timeout(9000) });
        if (!res.ok) return false;
        const json = await res.json();
        if (json.error) return false;

        const albumData = json.track?.album;
        if (albumData) {
            if (!track.album || track.album === 'Unknown Album') {
                track.album = albumData.title || track.album;
            }
            if (!track.albumImage) {
                const images = albumData.image || [];
                // Last.fm sizes: small, medium, large, extralarge, mega
                const best =
                    images.find(i => i.size === 'extralarge') ||
                    images.find(i => i.size === 'large') ||
                    images[images.length - 1];
                const url = best?.['#text']?.trim();
                track.albumImage = url || null;
            }
        }

        // Genre tags — stored on track for callers that want them (e.g. metadataWorker)
        const tags = json.track?.toptags?.tag;
        if (Array.isArray(tags) && tags.length > 0) {
            track._lastfmTags = tags
                .map(t => (typeof t.name === 'string' ? t.name.trim() : ''))
                .filter(Boolean)
                .slice(0, 5);
        }

        if (track.album && track.albumImage) {
            track._enrichSource = 'lastfm';
        }
        return !!(track.album && track.albumImage);
    } catch (_err) {
        return false;
    }
}

// ── Tier 5: MusicBrainz + Cover Art Archive ───────────────────────────────────
// Last resort. Strict 1 req/s rate limit — always serialized with 1100ms gap.
// MBIDs link to Cover Art Archive for album art.

async function fetchFromMusicBrainz(track) {
    const artist = track.artists?.[0] || '';
    const query = encodeURIComponent(`recording:"${track.name}" AND artist:"${artist}"`);
    const headers = { 'User-Agent': 'Demus/1.0 (https://github.com/demus-app)' };

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
                releases.find(
                    r =>
                        r.status === 'Official' &&
                        r['release-group']?.['primary-type'] === 'Album' &&
                        !(r['release-group']?.['secondary-types'] ?? []).some(s =>
                            ['Live', 'Compilation', 'Soundtrack', 'Remix'].includes(s)
                        )
                ) ||
                releases.find(
                    r =>
                        r.status === 'Official' &&
                        r['release-group']?.['primary-type'] === 'Album'
                ) ||
                releases.find(r => r.status === 'Official') ||
                releases[0];

            if (candidate && candidate.status !== 'Bootleg') {
                bestRelease = candidate;
                break;
            }
        }

        if (!bestRelease) return false;

        if (!track.album || track.album === 'Unknown Album') {
            track.album = bestRelease.title || track.album;
        }

        if (!track.albumImage && bestRelease.id) {
            try {
                const caaRes = await fetch(
                    `https://coverartarchive.org/release/${bestRelease.id}`,
                    { signal: AbortSignal.timeout(8000), headers }
                );
                if (caaRes.ok) {
                    const caaJson = await caaRes.json();
                    const img = caaJson.images?.find(i => i.front) || caaJson.images?.[0];
                    if (img) {
                        track.albumImage =
                            img.thumbnails?.['500'] ||
                            img.thumbnails?.large ||
                            img.image ||
                            null;
                    }
                }
            } catch (_) { /* non-fatal */ }
        }

        if (track.album && track.albumImage) {
            track._enrichSource = 'musicbrainz';
        }
        return !!(track.album && track.albumImage);
    } catch (err) {
        logWarn('enrichment', `MusicBrainz error for "${track.name}": ${err.message}`);
        return false;
    }
}

// ── Orchestrator ──────────────────────────────────────────────────────────────

/**
 * Enrich a batch of tracks through the 5-tier waterfall.
 * Only tracks still missing album or albumImage are forwarded to each next tier.
 * Mutates track objects in place.
 *
 * @param {object[]} tracks  Track objects (need .name, .artists, .album, .albumImage)
 * @param {string}   tag     Log prefix, e.g. 'artistExpandWorker'
 */
async function enrichTracks(tracks, tag) {
    // Gate: skip tracks that are already complete
    const needsWork = tracks.filter(needsEnrichment);
    if (needsWork.length === 0) return;

    if (isDev) {
        console.log(`[${tag}] Enriching ${needsWork.length}/${tracks.length} track(s) missing album/image...`);
    }

    // ── Tier 1: iTunes (5 concurrent, 300 ms between batches) ────────────────
    for (let i = 0; i < needsWork.length; i += 5) {
        await Promise.all(needsWork.slice(i, i + 5).map(fetchFromItunes));
        if (i + 5 < needsWork.length) await sleep(300);
    }

    const afterItunes = needsWork.filter(needsEnrichment);
    if (afterItunes.length === 0) {
        if (isDev) console.log(`[${tag}] iTunes resolved all.`);
        return;
    }
    if (isDev) console.log(`[${tag}] iTunes missed ${afterItunes.length} — trying Deezer...`);

    // ── Tier 2: Deezer (5 concurrent, 250 ms between batches) ────────────────
    for (let i = 0; i < afterItunes.length; i += 5) {
        await Promise.all(afterItunes.slice(i, i + 5).map(fetchFromDeezer));
        if (i + 5 < afterItunes.length) await sleep(250);
    }

    const afterDeezer = afterItunes.filter(needsEnrichment);
    if (afterDeezer.length === 0) {
        if (isDev) console.log(`[${tag}] Deezer resolved remaining.`);
        return;
    }
    if (isDev) console.log(`[${tag}] Deezer missed ${afterDeezer.length} — trying TheAudioDB...`);

    // ── Tier 3: TheAudioDB (serialized, 500 ms apart) ─────────────────────────
    for (let i = 0; i < afterDeezer.length; i++) {
        await fetchFromTheAudioDB(afterDeezer[i]);
        if (i < afterDeezer.length - 1) await sleep(500);
    }

    const afterAudioDB = afterDeezer.filter(needsEnrichment);
    if (afterAudioDB.length === 0) {
        if (isDev) console.log(`[${tag}] TheAudioDB resolved remaining.`);
        return;
    }

    // ── Tier 4: Last.fm (optional, serialized, 500 ms apart) ─────────────────
    if (process.env.LASTFM_API_KEY) {
        if (isDev) console.log(`[${tag}] TheAudioDB missed ${afterAudioDB.length} — trying Last.fm...`);
        for (let i = 0; i < afterAudioDB.length; i++) {
            await fetchFromLastfm(afterAudioDB[i]);
            if (i < afterAudioDB.length - 1) await sleep(500);
        }
    }

    const afterLastfm = afterAudioDB.filter(needsEnrichment);
    if (afterLastfm.length === 0) return;
    if (isDev) console.log(`[${tag}] Still missing ${afterLastfm.length} — trying MusicBrainz (slow)...`);

    // ── Tier 5: MusicBrainz (serialized, 1100 ms apart — strict 1 req/s) ─────
    for (let i = 0; i < afterLastfm.length; i++) {
        await fetchFromMusicBrainz(afterLastfm[i]);
        if (i < afterLastfm.length - 1) await sleep(1100);
    }

    if (isDev) {
        const stillMissing = afterLastfm.filter(needsEnrichment).length;
        if (stillMissing > 0) {
            console.log(`[${tag}] ${stillMissing} track(s) remain without full metadata after all tiers.`);
        }
    }
}

module.exports = { enrichTracks, cleanTrackName };
