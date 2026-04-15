let spotifyGetDataPromise = null;

function normalizeArtistName(value) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function extractSpotifyArtistId(artist) {
    if (!artist || typeof artist !== 'object') return null;
    if (typeof artist.id === 'string' && artist.id.trim()) return artist.id.trim();
    if (typeof artist.uri === 'string' && artist.uri.trim()) {
        const fromUri = artist.uri.split(':').pop();
        return typeof fromUri === 'string' && fromUri.trim() ? fromUri.trim() : null;
    }
    return null;
}

async function getSpotifyGetData() {
    if (!spotifyGetDataPromise) {
        spotifyGetDataPromise = import('spotify-url-info')
            .then((module) => module.default(fetch).getData)
            .catch(() => null);
    }
    return spotifyGetDataPromise;
}

/**
 * Resolve a canonical Spotify artist target from user-provided Spotify ID input.
 * Supports both artist IDs and track IDs (track IDs are remapped to their primary artist).
 *
 * @param {{ spotifyId: string, artistName?: string | null }} input
 * @returns {Promise<{ artistSpotifyId: string, artistName: string | null, source: 'artist' | 'track' } | null>}
 */
export async function resolveArtistTarget(input) {
    const spotifyId = typeof input?.spotifyId === 'string' ? input.spotifyId.trim() : '';
    const requestedName = normalizeArtistName(input?.artistName);
    if (!spotifyId) return null;

    const getData = await getSpotifyGetData();
    if (!getData) {
        return {
            artistSpotifyId: spotifyId,
            artistName: requestedName,
            source: 'artist',
        };
    }

    try {
        const artistData = await getData(`https://open.spotify.com/artist/${spotifyId}`);
        const artistName = normalizeArtistName(artistData?.name) || requestedName;
        return {
            artistSpotifyId: spotifyId,
            artistName,
            source: 'artist',
        };
    } catch (_) {
        // fall through to track fallback
    }

    try {
        const trackData = await getData(`https://open.spotify.com/track/${spotifyId}`);
        const primaryArtist = Array.isArray(trackData?.artists) ? trackData.artists[0] : null;
        const artistSpotifyId = extractSpotifyArtistId(primaryArtist);
        if (!artistSpotifyId) return null;

        const artistName = normalizeArtistName(primaryArtist?.name || primaryArtist?.title) || requestedName;
        return {
            artistSpotifyId,
            artistName,
            source: 'track',
        };
    } catch (_) {
        return null;
    }
}

export { normalizeArtistName };
