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
 * Genre chain (in order):
 *   1. Spotify Web API (artist genres via anonymous embed token)
 *   2. Last.fm track tags (if LASTFM_API_KEY exists)
 *   3. TheAudioDB track metadata
 *   4. Deezer artist/genre endpoints
 *   5. MusicBrainz recording tags/genres
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
const LASTFM_MIN_GAP_MS = 550;
const MUSICBRAINZ_MIN_GAP_MS = 1100;
const MIN_MUSICBRAINZ_TAG_WEIGHT = 2;
const DEFAULT_GENRE_PROVIDER_ORDER = ['spotify', 'lastfm', 'theaudiodb', 'deezer', 'musicbrainz'];
let lastLastfmRequestAt = 0;
let lastMusicBrainzRequestAt = 0;
const LOW_QUALITY_GENRE_TOKENS = new Set([
    'unknown',
    'misc',
    'miscellaneous',
    'other',
    'song',
    'songs',
    'track',
    'tracks',
    'music',
    'audio',
    'video',
    'lyrics',
    'lyric',
    'lyrics-video',
    'official-video',
    'official-audio',
    'seen-live',
]);
const LASTFM_LOW_SIGNAL_PARTS = new Set([
    'best',
    'favorites',
    'favorite',
    'fav',
    'playlist',
    'playlists',
    'radio',
    'fm',
    'songs',
    'song',
    'top',
    'my',
    'wsum',
    'soty',
]);

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

function normalizeGenres(values) {
    const source = Array.isArray(values) ? values : [values];
    const deduped = [];
    const seen = new Set();
    for (const value of source) {
        const normalized = normalizeGenreToken(value);
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        deduped.push(normalized);
        if (deduped.length >= 5) break;
    }
    return deduped;
}

function isLowQualityGenre(value) {
    if (LOW_QUALITY_GENRE_TOKENS.has(value)) return true;
    if (value.length < 3) return true;
    if (/^\d+$/.test(value)) return true;
    if (/(^|-)official($|-)/.test(value)) return true;
    if (/(^|-)lyrics?($|-)/.test(value)) return true;
    if (/(^|-)audio($|-)/.test(value)) return true;
    if (/(^|-)video($|-)/.test(value)) return true;
    return false;
}

function isLowSignalLastfmGenre(value) {
    const parts = value.split('-').filter(Boolean);
    if (value.length > 28) return true;
    if (parts.length >= 5) return true;
    const digitCount = (value.match(/\d/g) || []).length;
    if (digitCount >= 3) return true;
    if (parts.some((part) => LASTFM_LOW_SIGNAL_PARTS.has(part))) return true;
    if (/(^|-)line(dance)?($|-)/.test(value)) return true;
    if (/(^|-)top-songs?($|-)/.test(value)) return true;
    return false;
}

function setTrackGenres(track, values, source, confidence) {
    const genres = normalizeGenres(values)
        .filter((value) => !isLowQualityGenre(value))
        .filter((value) => (source === 'lastfm' ? !isLowSignalLastfmGenre(value) : true));
    if (!genres.length) return false;
    track._genreTags = genres;
    track._genreSource = source;
    if (typeof confidence === 'number') {
        track._genreConfidence = Math.max(0, Math.min(1, confidence));
    }
    if (source === 'lastfm') {
        track._lastfmTags = genres;
    }
    return true;
}

function splitGenreField(raw) {
    if (typeof raw !== 'string') return [];
    return raw
        .split(/[\/|,;]/g)
        .map((value) => value.trim())
        .filter(Boolean);
}

async function throttleProvider(minGapMs, timestampRef) {
    const elapsed = Date.now() - timestampRef.value;
    if (elapsed < minGapMs) {
        await sleep(minGapMs - elapsed);
    }
    timestampRef.value = Date.now();
}

function getPrimaryArtist(track) {
    return typeof track.artists?.[0] === 'string' ? track.artists[0].trim() : '';
}

function normalizeArtistCacheKey(value) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim().toLowerCase();
    return trimmed || null;
}

function normalizeProviderName(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'audiodb' || normalized === 'audio-db') return 'theaudiodb';
    if (normalized === 'spotify-artist') return 'spotify';
    return normalized;
}

function getGenreProviderOrder() {
    const rawOrder = process.env.GENRE_PROVIDER_ORDER;
    if (!rawOrder) return [...DEFAULT_GENRE_PROVIDER_ORDER];

    const requested = rawOrder
        .split(',')
        .map((value) => normalizeProviderName(value))
        .filter(Boolean);
    const deduped = [];
    const seen = new Set();
    for (const provider of requested) {
        if (!DEFAULT_GENRE_PROVIDER_ORDER.includes(provider) || seen.has(provider)) continue;
        seen.add(provider);
        deduped.push(provider);
    }
    for (const provider of DEFAULT_GENRE_PROVIDER_ORDER) {
        if (seen.has(provider)) continue;
        deduped.push(provider);
    }
    return deduped;
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

    const artist = getPrimaryArtist(track);
    const name = track.name || '';
    if (!artist || !name) return false;

    try {
        await throttleProvider(LASTFM_MIN_GAP_MS, {
            get value() {
                return lastLastfmRequestAt;
            },
            set value(next) {
                lastLastfmRequestAt = next;
            },
        });
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
            const tagNames = tags
                .map(t => (typeof t.name === 'string' ? t.name.trim() : ''))
                .filter(Boolean)
                .slice(0, 5);
            setTrackGenres(track, tagNames, 'lastfm', 0.9);
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
    const artist = getPrimaryArtist(track);
    const query = encodeURIComponent(`recording:"${track.name}" AND artist:"${artist}"`);
    const headers = { 'User-Agent': 'Demus/1.0 (https://github.com/demus-app)' };

    try {
        await throttleProvider(MUSICBRAINZ_MIN_GAP_MS, {
            get value() {
                return lastMusicBrainzRequestAt;
            },
            set value(next) {
                lastMusicBrainzRequestAt = next;
            },
        });
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

async function getSpotifyAccessToken(trackSpotifyId, cache) {
    if (cache.disabled) return null;
    if (cache.token && cache.expiresAt > Date.now()) return cache.token;
    if (!trackSpotifyId) return null;

    try {
        const res = await fetch(`https://open.spotify.com/embed/track/${trackSpotifyId}`, {
            headers: {
                'User-Agent':
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
                    'AppleWebKit/537.36 (KHTML, like Gecko) ' +
                    'Chrome/124.0.0.0 Safari/537.36',
                'Accept': 'text/html',
            },
            signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) return null;
        const html = await res.text();
        const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([^<]+)<\/script>/);
        if (!match) return null;

        const nextData = JSON.parse(match[1]);
        const session = nextData?.props?.pageProps?.state?.settings?.session;
        const token = session?.accessToken;
        if (!token) return null;

        const expirationMs = Number(session?.accessTokenExpirationTimestampMs);
        cache.token = token;
        cache.expiresAt = Number.isFinite(expirationMs)
            ? Math.max(Date.now(), expirationMs - 60_000)
            : Date.now() + (10 * 60_000);
        cache.tokenFailures = 0;

        return cache.token;
    } catch (err) {
        cache.tokenFailures = (cache.tokenFailures || 0) + 1;
        if (cache.tokenFailures >= 5) {
            cache.disabled = true;
        }
        logWarn('enrichment', `Spotify token fetch failed: ${err.message}`);
        return null;
    }
}

async function fetchSpotifyJson(url, trackSpotifyId, cache, allowRetry = true) {
    const token = await getSpotifyAccessToken(trackSpotifyId, cache);
    if (!token) return null;

    const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(9000),
    });

    if (res.status === 401 && allowRetry) {
        cache.token = null;
        cache.expiresAt = 0;
        return fetchSpotifyJson(url, trackSpotifyId, cache, false);
    }
    if (!res.ok) return null;
    return res.json();
}

async function fetchGenresFromSpotifyArtistSearch(track, cache) {
    const artistName = getPrimaryArtist(track);
    const artistCacheKey = normalizeArtistCacheKey(artistName);
    if (!artistCacheKey) return false;

    if (cache.artistNameGenres.has(artistCacheKey)) {
        return setTrackGenres(track, cache.artistNameGenres.get(artistCacheKey), 'spotify-artist', 0.9);
    }

    const searchQuery = encodeURIComponent(`artist:${artistName}`);
    const searchJson = await fetchSpotifyJson(
        `https://api.spotify.com/v1/search?q=${searchQuery}&type=artist&limit=1`,
        track.spotifyId,
        cache.spotifyAuth
    );
    const genres = Array.isArray(searchJson?.artists?.items?.[0]?.genres)
        ? searchJson.artists.items[0].genres
        : [];
    cache.artistNameGenres.set(artistCacheKey, genres);
    return setTrackGenres(track, genres, 'spotify-artist', 0.9);
}

async function fetchGenresFromSpotify(track, cache) {
    if (!track.spotifyId) return false;

    try {
        let artistId = cache.trackArtistIds.get(track.spotifyId) || null;
        if (!artistId) {
            const trackJson = await fetchSpotifyJson(
                `https://api.spotify.com/v1/tracks/${track.spotifyId}?fields=artists(id)`,
                track.spotifyId,
                cache.spotifyAuth
            );
            artistId = trackJson?.artists?.[0]?.id || null;
            if (!artistId) return false;
            cache.trackArtistIds.set(track.spotifyId, artistId);
        }

        let genres = cache.artistGenres.get(artistId) || null;
        if (!genres) {
            const artistJson = await fetchSpotifyJson(
                `https://api.spotify.com/v1/artists/${artistId}?fields=genres`,
                track.spotifyId,
                cache.spotifyAuth
            );
            genres = Array.isArray(artistJson?.genres) ? artistJson.genres : [];
            cache.artistGenres.set(artistId, genres);
        }

        if (setTrackGenres(track, genres, 'spotify-artist', 0.95)) {
            const artistCacheKey = normalizeArtistCacheKey(getPrimaryArtist(track));
            if (artistCacheKey) {
                cache.artistNameGenres.set(artistCacheKey, track._genreTags);
            }
            return true;
        }
        return fetchGenresFromSpotifyArtistSearch(track, cache);
    } catch (err) {
        logWarn('enrichment', `Spotify genre fetch failed for "${track.name}": ${err.message}`);
        try {
            return fetchGenresFromSpotifyArtistSearch(track, cache);
        } catch (searchErr) {
            logWarn('enrichment', `Spotify artist search failed for "${track.name}": ${searchErr.message}`);
            return false;
        }
    }
}

async function fetchGenresFromAudioDb(track, cache) {
    const artist = getPrimaryArtist(track);
    const name = track.name || '';
    if (!artist || !name) return false;

    const cacheKey = `${artist.toLowerCase()}::${name.toLowerCase()}`;
    if (cache.audioDb.has(cacheKey)) {
        return setTrackGenres(track, cache.audioDb.get(cacheKey), 'theaudiodb', 0.7);
    }

    const trackNames = [cleanTrackName(name), name].filter((value, idx, arr) => arr.indexOf(value) === idx);

    for (const trackName of trackNames) {
        try {
            const url = `https://www.theaudiodb.com/api/v1/json/${THEAUDIODB_KEY}/searchtrack.php` +
                `?s=${encodeURIComponent(artist)}&t=${encodeURIComponent(trackName)}`;
            const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
            if (!res.ok) continue;
            const json = await res.json();
            const hit = json.track?.[0];
            if (!hit) continue;

            const genres = [
                ...splitGenreField(hit.strGenre),
                ...splitGenreField(hit.strStyle),
            ];
            const normalized = normalizeGenres(genres);
            cache.audioDb.set(cacheKey, normalized);
            return setTrackGenres(track, normalized, 'theaudiodb', 0.7);
        } catch (err) {
            logWarn('enrichment', `TheAudioDB genre fetch failed for "${track.name}": ${err.message}`);
            break;
        }
    }

    cache.audioDb.set(cacheKey, []);
    return false;
}

async function fetchGenresFromDeezer(track, cache) {
    const artist = getPrimaryArtist(track);
    const name = track.name || '';
    if (!artist || !name) return false;

    try {
        const q = `artist:"${artist}" track:"${cleanTrackName(name) || name}"`;
        const searchUrl = `https://api.deezer.com/search?q=${encodeURIComponent(q)}&limit=1`;
        const searchRes = await fetch(searchUrl, { signal: AbortSignal.timeout(9000) });
        if (!searchRes.ok) return false;
        const searchJson = await searchRes.json();
        const hit = searchJson.data?.[0];
        if (!hit) return false;

        let genres = [];
        const artistId = hit.artist?.id;
        if (artistId) {
            if (cache.deezerArtistGenres.has(artistId)) {
                genres = cache.deezerArtistGenres.get(artistId);
            } else {
                const artistRes = await fetch(`https://api.deezer.com/artist/${artistId}`, {
                    signal: AbortSignal.timeout(9000),
                });
                if (artistRes.ok) {
                    const artistJson = await artistRes.json();
                    genres = Array.isArray(artistJson?.genres?.data)
                        ? artistJson.genres.data.map((genre) => genre?.name).filter(Boolean)
                        : [];

                    if (!genres.length && Number.isFinite(Number(artistJson?.genre_id))) {
                        const deezerGenreId = Number(artistJson.genre_id);
                        const genreRes = await fetch(`https://api.deezer.com/genre/${deezerGenreId}`, {
                            signal: AbortSignal.timeout(9000),
                        });
                        if (genreRes.ok) {
                            const genreJson = await genreRes.json();
                            if (typeof genreJson?.name === 'string' && genreJson.name.trim()) {
                                genres = [genreJson.name.trim()];
                            }
                        }
                    }
                }
                cache.deezerArtistGenres.set(artistId, normalizeGenres(genres));
                genres = cache.deezerArtistGenres.get(artistId);
            }
        }

        return setTrackGenres(track, genres, 'deezer', 0.75);
    } catch (err) {
        logWarn('enrichment', `Deezer genre fetch failed for "${track.name}": ${err.message}`);
        return false;
    }
}

async function fetchGenresFromMusicBrainz(track) {
    const artist = getPrimaryArtist(track);
    const name = cleanTrackName(track.name || '');
    if (!artist || !name) return false;

    const headers = {
        'User-Agent': 'Demus/1.0 (https://github.com/demus-app)',
    };
    const query = encodeURIComponent(`recording:"${name}" AND artist:"${artist}"`);

    try {
        await throttleProvider(MUSICBRAINZ_MIN_GAP_MS, {
            get value() {
                return lastMusicBrainzRequestAt;
            },
            set value(next) {
                lastMusicBrainzRequestAt = next;
            },
        });
        const url =
            `https://musicbrainz.org/ws/2/recording/?query=${query}` +
            `&fmt=json&limit=5&inc=tags+genres`;
        const res = await fetch(url, { headers, signal: AbortSignal.timeout(12000) });
        if (!res.ok) return false;
        const json = await res.json();
        const recordings = Array.isArray(json.recordings) ? json.recordings : [];
        if (!recordings.length) return false;

        const weights = new Map();
        for (const recording of recordings.slice(0, 3)) {
            const candidates = [
                ...(Array.isArray(recording.genres) ? recording.genres : []),
                ...(Array.isArray(recording.tags) ? recording.tags : []),
            ];
            for (const item of candidates) {
                const nameValue = typeof item?.name === 'string' ? item.name : null;
                const normalized = normalizeGenreToken(nameValue);
                if (!normalized) continue;
                const count = Number.isFinite(Number(item?.count)) ? Number(item.count) : 1;
                weights.set(normalized, (weights.get(normalized) || 0) + count);
            }
        }

        const genres = [...weights.entries()]
            .sort((a, b) => b[1] - a[1])
            .filter(([, score]) => score >= MIN_MUSICBRAINZ_TAG_WEIGHT)
            .slice(0, 5)
            .map(([genre]) => genre);
        return setTrackGenres(track, genres, 'musicbrainz', 0.65);
    } catch (err) {
        logWarn('enrichment', `MusicBrainz genre fetch failed for "${track.name}": ${err.message}`);
        return false;
    }
}

async function enrichTrackGenres(tracks, tag) {
    const targets = tracks.filter((track) => {
        const existingGenres = Array.isArray(track.genres) && track.genres.length > 0;
        const computedGenres = Array.isArray(track._genreTags) && track._genreTags.length > 0;
        return !existingGenres && !computedGenres;
    });
    if (targets.length === 0) return;

    const cache = {
        spotifyAuth: {
            token: null,
            expiresAt: 0,
            disabled: false,
            tokenFailures: 0,
        },
        trackArtistIds: new Map(),
        artistGenres: new Map(),
        artistNameGenres: new Map(),
        audioDb: new Map(),
        deezerArtistGenres: new Map(),
        artistGenreMemory: new Map(),
    };
    const sourceCounts = new Map();
    let unresolved = 0;
    const providerOrder = getGenreProviderOrder();
    const hasComputedGenres = (track) =>
        Array.isArray(track._genreTags) && track._genreTags.length > 0;
    const providerExecutors = {
        spotify: (track) => fetchGenresFromSpotify(track, cache),
        lastfm: async (track) => {
            if (!process.env.LASTFM_API_KEY) return false;
            await fetchFromLastfm(track);
            return hasComputedGenres(track);
        },
        theaudiodb: (track) => fetchGenresFromAudioDb(track, cache),
        deezer: (track) => fetchGenresFromDeezer(track, cache),
        musicbrainz: (track) => fetchGenresFromMusicBrainz(track),
    };

    if (isDev) {
        console.log(`[${tag}] Resolving genres for ${targets.length} track(s)...`);
        console.log(`[${tag}] Genre provider order: ${providerOrder.join(' -> ')}`);
    }

    for (const track of targets) {
        let resolved = false;
        const artistCacheKey = normalizeArtistCacheKey(getPrimaryArtist(track));

        if (!resolved && artistCacheKey && cache.artistGenreMemory.has(artistCacheKey)) {
            resolved = setTrackGenres(
                track,
                cache.artistGenreMemory.get(artistCacheKey),
                'artist-cache',
                0.55
            );
        }

        for (const provider of providerOrder) {
            if (resolved) break;
            const executeProvider = providerExecutors[provider];
            if (!executeProvider) continue;
            resolved = await executeProvider(track);
        }

        if (resolved) {
            const source = track._genreSource || 'unknown';
            sourceCounts.set(source, (sourceCounts.get(source) || 0) + 1);
            if (artistCacheKey && Array.isArray(track._genreTags) && track._genreTags.length > 0) {
                cache.artistGenreMemory.set(artistCacheKey, track._genreTags);
            }
        } else {
            unresolved++;
        }
    }

    if (isDev) {
        const breakdown = [...sourceCounts.entries()]
            .map(([source, count]) => `${source}:${count}`)
            .join(', ');
        if (breakdown) {
            console.log(`[${tag}] Genre sources -> ${breakdown}`);
        }
        if (unresolved > 0) {
            console.log(`[${tag}] Genres unresolved for ${unresolved} track(s).`);
        }
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
    if (needsWork.length === 0) {
        await enrichTrackGenres(tracks, tag);
        return;
    }

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
        await enrichTrackGenres(tracks, tag);
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
        await enrichTrackGenres(tracks, tag);
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
        await enrichTrackGenres(tracks, tag);
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
    if (afterLastfm.length === 0) {
        await enrichTrackGenres(tracks, tag);
        return;
    }
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

    await enrichTrackGenres(tracks, tag);
}

module.exports = { enrichTracks, enrichTrackGenres, cleanTrackName };
