import spotifyUrlInfo from 'spotify-url-info';
import Track from '@/models/Track';

// Initialize spotify-url-info with native fetch (Node 18+)
const { getData, getPreview, getTracks } = spotifyUrlInfo(fetch);

// ── Playlist ID Extraction ────────────────────────────────────────

/**
 * Extract Spotify playlist ID from various URL formats.
 * Supports:
 *   - https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M
 *   - https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=abc123
 *   - spotify:playlist:37i9dQZF1DXcBWIGoYBM5M
 *   - 37i9dQZF1DXcBWIGoYBM5M (raw ID)
 */
export function extractPlaylistId(input) {
    if (!input || typeof input !== 'string') return null;

    const trimmed = input.trim();

    // Direct ID (22 alphanumeric chars)
    if (/^[A-Za-z0-9]{22}$/.test(trimmed)) return trimmed;

    // Spotify URI
    const uriMatch = trimmed.match(/spotify:playlist:([A-Za-z0-9]+)/);
    if (uriMatch) return uriMatch[1];

    // HTTP URL
    try {
        const url = new URL(trimmed);
        const pathParts = url.pathname.split('/');
        const playlistIdx = pathParts.indexOf('playlist');
        if (playlistIdx !== -1 && pathParts[playlistIdx + 1]) {
            return pathParts[playlistIdx + 1].split('?')[0];
        }
    } catch {
        // not a valid URL
    }

    return null;
}

// ── Public Playlist Scraping (no API keys needed) ─────────────────

/**
 * Fetch playlist info + all tracks from a public Spotify playlist.
 * Uses Spotify's public embed page — NO developer account or API keys required.
 *
 * @param {string} playlistId  Spotify playlist ID
 * @returns {Promise<{ info: object, tracks: object[] }>}
 */
export async function getPublicPlaylistData(playlistId) {
    const spotifyUrl = `https://open.spotify.com/playlist/${playlistId}`;

    // --- Step 1: Get full embedded data ---
    let data;
    try {
        data = await getData(spotifyUrl);
    } catch (err) {
        console.error('[Spotify] getData failed:', err.message);
        throw new Error(
            'Could not fetch playlist from Spotify. Make sure the URL is correct and the playlist is set to Public.'
        );
    }

    // --- Step 2: Parse playlist metadata ---
    const info = {
        id: playlistId,
        name: data.name || data.title || 'Unknown Playlist',
        description: data.description || '',
        coverImage: extractImage(data),
        owner: extractOwner(data),
        totalTracks: 0, // updated below
    };

    // --- Step 3: Parse tracks (handle multiple embed data formats) ---
    let tracks = [];

    // Format B first: API-like structure (tracks.items) — includes full album data.
    if (data.tracks?.items && Array.isArray(data.tracks.items)) {
        tracks = data.tracks.items
            .map((item) => parseApiTrack(item.track || item))
            .filter(Boolean);
    }
    // Format A fallback: Modern embed (trackList array)
    // NOTE: Spotify's embed page does NOT include album name or album art per
    // track — only title, subtitle (artists), duration, and uri are present.
    else if (data.trackList && Array.isArray(data.trackList)) {
        tracks = data.trackList.map(parseEmbedTrack).filter(Boolean);
    }

    // Fallback: use getTracks() if we got nothing
    if (tracks.length === 0) {
        try {
            console.log('[Spotify] getData had no tracks, falling back to getTracks()');
            const rawTracks = await getTracks(spotifyUrl);
            tracks = rawTracks.map(parseApiTrack).filter(Boolean);
        } catch (e) {
            console.error('[Spotify] getTracks fallback also failed:', e.message);
        }
    }

    // --- Step 4: Final fallback — ensure no track has null for album.
    // iTunes enrichment now runs in the background after the response; this
    // guarantees every track at least has a string value for immediate use.
    for (const t of tracks) {
        if (!t.album) t.album = 'Unknown Album';
    }

    info.totalTracks = tracks.length;

    if (tracks.length === 0) {
        throw new Error(
            'Playlist appears empty or Spotify blocked the request. Make sure the playlist is public and contains tracks.'
        );
    }

    return { info, tracks };
}

// ── Internal Parsers ──────────────────────────────────────────────

/** Parse a track from the modern embed trackList format.
 *  NOTE: Spotify's embed page only returns title, subtitle (artists), duration,
 *  and uri — NO album name or album art. enrichTracksWithItunes() fills those in.
 */
function parseEmbedTrack(t) {
    if (!t) return null;

    const spotifyId = t.uri?.split(':').pop() || null;
    if (!spotifyId) return null;

    return {
        spotifyId,
        name: t.title || t.name || 'Unknown',
        artists: parseArtists(t.subtitle || t.artists),
        album: null,       // filled in by enrichTracksWithItunes
        albumImage: null,  // filled in by enrichTracksWithItunes
        duration: t.duration || t.duration_ms || 0,
    };
}

// ── Multi-Source Metadata Enrichment ─────────────────────────────
//
// Three-tier free enrichment pipeline (no API keys for any source):
//
//   Tier 1 — iTunes Search API   : fast, concurrent, great mainstream coverage
//   Tier 2 — Spotify OG scrape   : 100% coverage — every track has a spotifyId;
//                                  fetches open.spotify.com/track/{id} and
//                                  reads og:image + og:description for album art
//                                  and album name directly from Spotify's CDN.
//   Tier 3 — MusicBrainz + CAA   : last-resort fallback, 1 req/s, open-source
//

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ── Tier 1: iTunes ────────────────────────────────────────────────

/**
 * Try to enrich a single track with album + art from the iTunes Search API.
 * Returns true if BOTH fields were resolved, false otherwise.
 * Mutates the track object in-place.
 */
/** Strip featured-artist / version tags that confuse iTunes search. */
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
    // Try cleaned name first (strips feat./version suffixes that confuse iTunes),
    // then fall back to the original name.
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
                    console.warn('[iTunes] 403 rate-limit hit — skipping iTunes tier for this run');
                    return false;
                }
                if (res.status === 429 || res.status >= 500) {
                    const backoff = 500 * Math.pow(2, attempt);
                    console.warn(`[iTunes] ${res.status} for "${track.name}", retrying in ${backoff}ms`);
                    await sleep(backoff);
                    attempt++;
                    continue;
                }

                if (!res.ok) break; // non-retryable → try next query string

                const body = await res.text();
                if (!body) break;
                const json = JSON.parse(body);
                const result = json.results?.[0];
                if (!result) break; // no match → try next query string

                if (!track.album || track.album === 'Unknown Album') {
                    track.album = result.collectionName || track.album;
                }
                if (!track.albumImage && result.artworkUrl100) {
                    track.albumImage = result.artworkUrl100.replace('100x100bb', '600x600bb');
                }

                return !!(track.album && track.albumImage);
            } catch (err) {
                const backoff = 500 * Math.pow(2, attempt);
                console.warn(`[iTunes] Error for "${track.name}" (attempt ${attempt + 1}):`, err.message);
                if (attempt < MAX_RETRIES - 1) await sleep(backoff);
                attempt++;
            }
        }
    }
    return false;
}

// ── Tier 2: Deezer ───────────────────────────────────────────────

/**
 * Try to enrich a single track using the Deezer search API.
 * No API key required — Deezer's public search endpoint is open.
 * Returns true if BOTH album name and art were resolved, false otherwise.
 * Mutates the track object in-place.
 */
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
            // In this state no further queries will succeed — bail out early
            // to avoid wasting time. The rate-limit window typically clears
            // within a few minutes.
            if (json.data?.length === 0 && (json.total ?? 0) > 0) {
                console.warn('[Deezer] Silent rate-limit detected (data:[] but total>0) — skipping Deezer tier');
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
            console.warn(`[Deezer] Error for "${track.name}":`, err.message);
        }
    }
    return !!(track.album && track.album !== 'Unknown Album' && track.albumImage);
}

// ── Tier 3: Spotify OG Scrape (kept for reference — DEAD) ─────────
// Removed: Spotify now serves a full Next.js SPA shell with no
// server-rendered OG meta tags. fetchFromSpotifyOG is no longer called.

/**
 * [DEAD] Fetch album name + art by scraping the Open Graph meta tags from
 * open.spotify.com/track/{spotifyId}. No longer works — Spotify removed OG tags.
 *
 * og:description format:  "{Artist} · {Album} · Song · {Year}"
 * og:image               :  Spotify CDN JPEG (same image shown in the app)
 *
 * Run at most 3 requests concurrently with a 500 ms delay between batches
 * to stay well below Spotify's server-side rate limit.
 *
 * Returns true if both fields were resolved, false otherwise.
 * Mutates the track object in-place.
 */
async function fetchFromSpotifyOG(track) {
    if (!track.spotifyId) return false;

    const url = `https://open.spotify.com/track/${track.spotifyId}`;
    const UA =
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
        'AppleWebKit/537.36 (KHTML, like Gecko) ' +
        'Chrome/122.0.0.0 Safari/537.36';

    try {
        const res = await fetch(url, {
            signal: AbortSignal.timeout(10000),
            headers: { 'User-Agent': UA, Accept: 'text/html' },
        });
        if (!res.ok) return false;

        const html = await res.text();

        // Extract og:image
        if (!track.albumImage) {
            const imgMatch = html.match(/property="og:image"\s+content="([^"]+)"/);
            if (imgMatch?.[1]) track.albumImage = imgMatch[1];
        }

        // Extract album name from og:description: "{Artist} · {Album} · Song · {Year}"
        if (!track.album || track.album === 'Unknown Album') {
            const descMatch = html.match(/property="og:description"\s+content="([^"]+)"/);
            if (descMatch?.[1]) {
                // Segment 1 (0-indexed) is the album name
                const parts = descMatch[1].split('·');
                const albumName = parts[1]?.trim();
                if (albumName) track.album = albumName;
            }
        }

        return !!(track.albumImage && track.album && track.album !== 'Unknown Album');
    } catch (err) {
        console.warn(`[SpotifyOG] Error for "${track.name}":`, err.message);
        return false;
    }
}

// ── Tier 3: MusicBrainz + CoverArtArchive ────────────────────────

/**
 * Try to enrich a single track from MusicBrainz (album name) and the
 * Cover Art Archive (album image).  Both services are free and require no
 * API key.  MusicBrainz enforces a strict 1 req/s rate limit — callers
 * must serialise calls to this function (no parallel execution).
 * Returns true if at least the album name was resolved, false otherwise.
 * Mutates the track object in-place.
 */
async function fetchFromMusicBrainz(track) {
    const artist = track.artists?.[0] || '';
    // MusicBrainz Lucene query syntax — use cleaned name so "Song (feat. X)" finds "Song"
    const cleanedName = cleanTrackName(track.name);
    const query = encodeURIComponent(
        `recording:"${cleanedName}" AND artist:"${artist}"`
    );
    const mbUrl =
        `https://musicbrainz.org/ws/2/recording/?query=${query}` +
        `&fmt=json&limit=10&inc=releases+release-groups`;

    const headers = {
        // MusicBrainz requires a descriptive User-Agent — without it requests fail
        'User-Agent': 'ProMusicApp/1.0 (https://github.com/pro-music-app)',
    };

    try {
        const res = await fetch(mbUrl, {
            signal: AbortSignal.timeout(12000),
            headers,
        });
        if (!res.ok) return false;

        const json = await res.json();

        // Search across the top few recordings to get the best release match
        let bestRelease = null;
        for (const recording of json.recordings?.slice(0, 5) ?? []) {
            const releases = recording.releases ?? [];

            // Priority 1: Official + Album + not a live/compilation/soundtrack
            const pureStudioOfficial = releases.find(
                (rel) =>
                    rel.status === 'Official' &&
                    rel['release-group']?.['primary-type'] === 'Album' &&
                    !(rel['release-group']?.['secondary-types'] ?? []).some((st) =>
                        ['Live', 'Compilation', 'Soundtrack', 'Remix'].includes(st)
                    )
            );

            // Priority 2: Official + Album (any secondary type but still official)
            const officialAlbum = releases.find(
                (rel) =>
                    rel.status === 'Official' &&
                    rel['release-group']?.['primary-type'] === 'Album'
            );

            // Priority 3: Any official release
            const officialAny = releases.find((rel) => rel.status === 'Official');

            const candidate =
                pureStudioOfficial || officialAlbum || officialAny || releases[0];

            // Skip bootlegs entirely if we found something better
            if (candidate && candidate.status !== 'Bootleg') {
                bestRelease = candidate;
                break;
            }
        }

        if (!bestRelease) return false;

        if (!track.album || track.album === 'Unknown Album') {
            track.album = bestRelease.title || track.album;
        }

        // Only hit CoverArtArchive if we have a release MBID and still need art
        if (!track.albumImage && bestRelease.id) {
            try {
                // The JSON endpoint returns stable image URLs — no byte streaming needed
                const caaUrl = `https://coverartarchive.org/release/${bestRelease.id}`;
                const caaRes = await fetch(caaUrl, {
                    signal: AbortSignal.timeout(8000),
                    headers,
                });
                if (caaRes.ok) {
                    const caaJson = await caaRes.json();
                    // Prefer front-cover thumbnail at 500px; fall back to any image
                    const front = caaJson.images?.find((img) => img.front);
                    const img = front || caaJson.images?.[0];
                    if (img) {
                        track.albumImage =
                            img.thumbnails?.['500'] ||
                            img.thumbnails?.large ||
                            img.image ||
                            null;
                    }
                }
            } catch (caaErr) {
                console.warn(`[CoverArtArchive] Error for "${track.name}":`, caaErr.message);
            }
        }

        return !!(track.album && track.albumImage);
    } catch (err) {
        console.warn(`[MusicBrainz] Error for "${track.name}":`, err.message);
        return false;
    }
}

// ── Orchestrator ──────────────────────────────────────────────────

/**
 * Background enrichment — call this AFTER saving tracks to MongoDB and
 * responding to the client.  Runs a three-tier fallback pipeline:
 *   iTunes → Spotify OG scrape → MusicBrainz + CoverArtArchive
 *
 * Persists results to MongoDB via bulkWrite when enrichment finishes.
 * This function never throws — all errors are caught and logged so that
 * enrichment failures cannot affect playlist import success.
 *
 * @param {object[]} tracks  Raw track objects with { spotifyId, name, artists[], album, albumImage }
 */
export async function runBackgroundItunesEnrichment(tracks) {
    const needsEnrichment = tracks.filter(
        (t) => !t.albumImage || !t.album || t.album === 'Unknown Album'
    );
    if (needsEnrichment.length === 0) return;

    console.log(`[Enrichment] Starting 3-tier pipeline for ${needsEnrichment.length} tracks...`);

    try {
        await enrichTracksWithMetadata(needsEnrichment);

        // Persist enriched fields back to MongoDB using spotifyId as the key.
        // Only write fields that were actually resolved — never persist null or
        // 'Unknown Album' back when a tier returned no data.
        const bulkOps = needsEnrichment
            .filter((t) => (t.album && t.album !== 'Unknown Album') || t.albumImage)
            .map((t) => ({
                updateOne: {
                    filter: { spotifyId: t.spotifyId },
                    update: {
                        $set: {
                            ...(t.album && t.album !== 'Unknown Album' ? { album: t.album } : {}),
                            ...(t.albumImage ? { albumImage: t.albumImage } : {}),
                        },
                    },
                },
            }));

        if (bulkOps.length > 0) {
            await Track.bulkWrite(bulkOps, { ordered: false });
            console.log(`[Enrichment] Persisted data for ${bulkOps.length} tracks.`);
        }
    } catch (err) {
        console.error('[Enrichment] Background error:', err.message);
    }
}

/**
 * Export for use by the /api/repair-enrichment endpoint.
 * Runs the full 3-tier pipeline on the given tracks in-place.
 */
export { enrichTracksWithMetadata };

/**
 * Three-tier metadata enrichment pipeline.
 * Mutates each track object directly with album name and art.
 *
 * Tier execution:
 *   1. iTunes         — up to 5 concurrent, 300 ms delay between batches (no key)
 *   2. Deezer         — up to 5 concurrent, 300 ms delay between batches (no key)
 *   3. MusicBrainz + CoverArtArchive — serialised at ~1 req/s (last resort, no key)
 *
 * @param {object[]} tracks  Array of track objects with { spotifyId, name, artists[] }
 */
async function enrichTracksWithMetadata(tracks) {
    // ── Tier 1: iTunes ──────────────────────────────────────────────
    const ITUNES_CONCURRENCY = 5;
    const ITUNES_BATCH_DELAY = 300;

    for (let i = 0; i < tracks.length; i += ITUNES_CONCURRENCY) {
        await Promise.all(
            tracks.slice(i, i + ITUNES_CONCURRENCY).map(fetchFromItunes)
        );
        if (i + ITUNES_CONCURRENCY < tracks.length) {
            await sleep(ITUNES_BATCH_DELAY);
        }
    }

    const afterItunes = tracks.filter(
        (t) => !t.albumImage || !t.album || t.album === 'Unknown Album'
    );
    if (afterItunes.length === 0) {
        console.log('[Enrichment] iTunes resolved all tracks.');
        return;
    }
    console.log(`[Enrichment] iTunes missed ${afterItunes.length} track(s) — trying Deezer...`);

    // ── Tier 2: Deezer ──────────────────────────────────────────────
    const DEEZER_CONCURRENCY = 5;
    const DEEZER_BATCH_DELAY = 300;

    for (let i = 0; i < afterItunes.length; i += DEEZER_CONCURRENCY) {
        await Promise.all(
            afterItunes.slice(i, i + DEEZER_CONCURRENCY).map(fetchFromDeezer)
        );
        if (i + DEEZER_CONCURRENCY < afterItunes.length) {
            await sleep(DEEZER_BATCH_DELAY);
        }
    }

    const afterDeezer = afterItunes.filter(
        (t) => !t.albumImage || !t.album || t.album === 'Unknown Album'
    );
    if (afterDeezer.length === 0) {
        console.log('[Enrichment] Deezer resolved all remaining tracks.');
        return;
    }
    console.log(`[Enrichment] Deezer missed ${afterDeezer.length} track(s) — trying MusicBrainz...`);

    // ── Tier 3: MusicBrainz + CoverArtArchive (serialised, 1 req/s) ─
    const MB_DELAY = 1100;

    for (let i = 0; i < afterDeezer.length; i++) {
        await fetchFromMusicBrainz(afterDeezer[i]);
        if (i < afterDeezer.length - 1) {
            await sleep(MB_DELAY);
        }
    }

    const stillMissing = afterDeezer.filter(
        (t) => !t.albumImage || !t.album || t.album === 'Unknown Album'
    );
    if (stillMissing.length > 0) {
        console.warn(
            `[Enrichment] ${stillMissing.length} track(s) unresolved after all tiers:`,
            stillMissing.map((t) => `"${t.name}" by ${t.artists?.[0]}`)
        );
    } else {
        console.log('[Enrichment] MusicBrainz resolved all remaining tracks.');
    }
}

/** Parse a track from the Spotify Web API-like format */
function parseApiTrack(t) {
    if (!t) return null;

    const spotifyId = t.id || t.uri?.split(':').pop() || null;
    if (!spotifyId) return null;

    return {
        spotifyId,
        name: t.name || t.title || 'Unknown',
        artists: t.artists
            ? t.artists.map((a) => (typeof a === 'string' ? a : a.name))
            : [],
        album: t.album?.name || 'Unknown Album',
        albumImage: t.album?.images?.[0]?.url || null,
        duration: t.duration_ms || t.duration || 0,
    };
}

/** Normalise artist input into a string array */
function parseArtists(input) {
    if (!input) return [];
    if (Array.isArray(input))
        return input.map((a) => (typeof a === 'string' ? a : a.name));
    if (typeof input === 'string') return input.split(/,\s*/);
    return [];
}

/** Extract best cover image from various data shapes */
function extractImage(data) {
    return (
        data.coverArt?.sources?.[0]?.url ||
        data.images?.[0]?.url ||
        data.coverArtSources?.[0]?.url ||
        null
    );
}

/** Extract owner/creator name */
function extractOwner(data) {
    if (data.subtitle) return data.subtitle.replace(/^By\s+/i, '');
    if (data.ownerV2?.data?.name) return data.ownerV2.data.name;
    if (data.owner?.display_name) return data.owner.display_name;
    if (data.owner?.id) return data.owner.id;
    return 'Unknown';
}
