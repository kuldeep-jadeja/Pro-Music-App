/**
 * generateFingerprint(name, artists)
 *
 * Produces a normalized, stable string identifier for a track derived from
 * its name and primary artist.  Identical songs that appear under slightly
 * different titles (e.g. remastered editions, featured-artist variants) will
 * collapse to the same fingerprint, dramatically improving MongoDB cache hit
 * rates across playlists that contain the same tracks in different forms.
 *
 * Algorithm (applied in order):
 *   1. Lowercase the track name
 *   2. Strip any content inside parentheses — removes "(Remastered)", "(feat. X)", etc.
 *   3. Remove the words "feat" / "featuring" (bare, outside parentheses)
 *   4. Remove "remaster" / "remastered" (bare, outside parentheses)
 *   5. Strip all remaining punctuation
 *   6. Collapse and trim whitespace
 *   7. Append the lowercased primary artist name
 *
 * Example:
 *   generateFingerprint("Blinding Lights (Remastered)", ["The Weeknd"])
 *   → "blinding lights the weeknd"
 *
 * @param {string}   name    - Track title as returned by Spotify scrape
 * @param {string[]} artists - Array of artist names; primary artist is artists[0]
 * @returns {string}
 */
export function generateFingerprint(name, artists) {
    let result = (name || '').toLowerCase();

    // Remove content inside parentheses (including the parentheses themselves)
    result = result.replace(/\([^)]*\)/g, '');

    // Remove bare "feat" / "featuring" tokens
    result = result.replace(/\bfeat(?:uring)?\b/g, '');

    // Remove bare "remaster" / "remastered" tokens
    result = result.replace(/\bremaster(?:ed)?\b/g, '');

    // Strip punctuation (keep only word chars and spaces)
    result = result.replace(/[^\w\s]/g, '');

    // Collapse internal whitespace and strip leading/trailing whitespace
    result = result.trim().replace(/\s+/g, ' ');

    // Append the lowercased primary artist name (stripped of punctuation)
    const primaryArtist = ((artists && artists[0]) || '')
        .toLowerCase()
        .replace(/[^\w\s]/g, '')
        .trim();

    return primaryArtist ? `${result} ${primaryArtist}`.trim() : result;
}
