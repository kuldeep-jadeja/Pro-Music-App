import ytSearch from 'yt-search';

/**
 * Search YouTube for the best matching video using yt-search (zero-quota scraping).
 *
 * Query format: "${artist} ${title} official audio"
 *
 * Scoring algorithm:
 *   +5  video title contains artist name
 *   +5  video title contains track title
 *   +2  video title contains "official"
 *   -3  contains "live"   (unless the track itself is a live recording)
 *   -3  contains "remix"  (unless the track itself is a remix)
 *   -3  contains "cover"
 *   -5  contains "karaoke" or "instrumental"
 *
 * Falls back to the first search result if all scores are non-positive.
 *
 * @param {string} artist - Primary artist name
 * @param {string} title  - Track title
 * @returns {Promise<string|null>} Best-matching YouTube video ID, or null
 */
export async function findYouTubeMatch(artist, title) {
    const query = `${artist} ${title} official audio`;

    const { videos } = await ytSearch({ query });

    if (!videos || videos.length === 0) return null;

    const candidates = videos.slice(0, 8);
    const titleLower = title.toLowerCase();
    const artistLower = artist.toLowerCase();

    let bestMatch = null;
    let bestScore = -Infinity;

    for (const video of candidates) {
        const videoTitle = (video.title || '').toLowerCase();
        let score = 0;

        // ── Positive signals ──────────────────────────────────
        if (videoTitle.includes(artistLower)) score += 5;
        if (videoTitle.includes(titleLower)) score += 5;
        if (videoTitle.includes('official')) score += 2;

        // ── Penalties ─────────────────────────────────────────
        if (videoTitle.includes('live') && !titleLower.includes('live')) score -= 3;
        if (videoTitle.includes('remix') && !titleLower.includes('remix')) score -= 3;
        if (videoTitle.includes('cover')) score -= 3;
        if (videoTitle.includes('karaoke') || videoTitle.includes('instrumental')) score -= 5;

        if (score > bestScore) {
            bestScore = score;
            bestMatch = video.videoId;
        }
    }

    // Fallback to first result if all scores are non-positive
    return bestScore > 0 ? bestMatch : candidates[0]?.videoId || null;
}
