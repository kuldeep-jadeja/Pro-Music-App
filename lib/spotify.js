import spotifyUrlInfo from 'spotify-url-info';

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

    // --- Step 4: Enrich tracks with album name + art from iTunes Search API ---
    // Runs only for tracks that are still missing album info (covers embed format
    // and any format gaps). Uses the free, no-auth iTunes Search API in batches.
    const needsEnrichment = tracks.filter((t) => !t.albumImage || !t.album || t.album === 'Unknown Album');
    if (needsEnrichment.length > 0) {
        console.log(`[iTunes] Enriching ${needsEnrichment.length} tracks with album data...`);
        await enrichTracksWithItunes(needsEnrichment);
    }

    // Final fallback: ensure no track has null for album
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

// ── iTunes Enrichment ─────────────────────────────────────────────

/**
 * Enrich tracks in-place with album name + high-res art via the free iTunes
 * Search API (no API key required). Mutates each track object directly.
 *
 * Runs at most 5 concurrent requests per batch with a delay between batches
 * and exponential-backoff retry on 429 responses, so large playlists (80+
 * tracks) don't trigger Apple's rate limiter.
 *
 * @param {object[]} tracks  Array of track objects with { name, artists[] }
 */
async function enrichTracksWithItunes(tracks) {
    const CONCURRENCY = 5;       // parallel requests per batch
    const BATCH_DELAY_MS = 300;  // pause between batches to avoid rate-limits
    const MAX_RETRIES = 3;       // max retries per track on 429 / server error

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    async function fetchOne(track) {
        const artist = track.artists?.[0] || '';
        const query = encodeURIComponent(`${artist} ${track.name}`);
        const url = `https://itunes.apple.com/search?term=${query}&media=music&entity=song&limit=1`;

        let attempt = 0;
        while (attempt < MAX_RETRIES) {
            try {
                const res = await fetch(url, { signal: AbortSignal.timeout(8000) });

                // Back off and retry on rate-limit or server errors
                if (res.status === 429 || res.status >= 500) {
                    const backoff = 500 * Math.pow(2, attempt); // 500ms, 1s, 2s
                    console.warn(`[iTunes] ${res.status} for "${track.name}", retrying in ${backoff}ms (attempt ${attempt + 1})`);
                    await sleep(backoff);
                    attempt++;
                    continue;
                }

                if (!res.ok) return; // 4xx other than 429 — not worth retrying

                const json = await res.json();
                const result = json.results?.[0];
                if (!result) return;

                // Album name
                if (!track.album || track.album === 'Unknown Album') {
                    track.album = result.collectionName || track.album || 'Unknown Album';
                }

                // High-res artwork: replace 100x100 thumb with 600x600
                if (!track.albumImage && result.artworkUrl100) {
                    track.albumImage = result.artworkUrl100.replace('100x100bb', '600x600bb');
                }
                return; // success — exit retry loop
            } catch (err) {
                // Network timeout or other transient error
                const backoff = 500 * Math.pow(2, attempt);
                console.warn(`[iTunes] Error for "${track.name}" (attempt ${attempt + 1}):`, err.message);
                if (attempt < MAX_RETRIES - 1) await sleep(backoff);
                attempt++;
            }
        }
    }

    // Process in batches of CONCURRENCY with a pause between each batch
    for (let i = 0; i < tracks.length; i += CONCURRENCY) {
        await Promise.all(tracks.slice(i, i + CONCURRENCY).map(fetchOne));

        // Pause between batches (skip delay after the last batch)
        if (i + CONCURRENCY < tracks.length) {
            await sleep(BATCH_DELAY_MS);
        }
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
