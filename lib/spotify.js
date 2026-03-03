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

    // Format A: Modern embed (trackList array)
    if (data.trackList && Array.isArray(data.trackList)) {
        tracks = data.trackList.map(parseEmbedTrack).filter(Boolean);
    }
    // Format B: API-like structure (tracks.items)
    else if (data.tracks?.items && Array.isArray(data.tracks.items)) {
        tracks = data.tracks.items
            .map((item) => parseApiTrack(item.track || item))
            .filter(Boolean);
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

    info.totalTracks = tracks.length;

    if (tracks.length === 0) {
        throw new Error(
            'Playlist appears empty or Spotify blocked the request. Make sure the playlist is public and contains tracks.'
        );
    }

    return { info, tracks };
}

// ── Internal Parsers ──────────────────────────────────────────────

/** Parse a track from the modern embed trackList format */
function parseEmbedTrack(t) {
    if (!t) return null;

    const spotifyId = t.uri?.split(':').pop() || null;
    if (!spotifyId) return null;

    return {
        spotifyId,
        name: t.title || 'Unknown',
        artists: parseArtists(t.subtitle || t.artists),
        album: t.album?.name || 'Unknown Album',
        albumImage:
            t.album?.images?.[0]?.url ||
            t.albumArt?.sources?.[0]?.url ||
            null,
        duration: t.duration || t.duration_ms || 0,
    };
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
