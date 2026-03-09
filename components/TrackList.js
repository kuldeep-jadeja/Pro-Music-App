import styles from '@/styles/TrackList.module.scss';

/**
 * Format milliseconds to M:SS
 */
function formatDuration(ms) {
    if (!ms) return '--:--';
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

// Determine the display state of a track
function trackState(track, playlistStatus) {
    if (track.youtubeVideoId) return 'available';
    if (playlistStatus === 'matching') return 'matching';
    return 'unavailable';
}

export default function TrackList({ tracks, currentTrackId, onTrackSelect, playlistStatus }) {
    if (!tracks || tracks.length === 0) {
        return <p className={styles.empty}>No tracks found.</p>;
    }

    // Sort: playable first, matching-in-progress second, no-match last.
    // Preserve the original index so onTrackSelect uses the correct playlist position.
    const sorted = tracks
        .map((track, originalIndex) => ({ track, originalIndex }))
        .sort((a, b) => {
            const order = (t) => {
                if (t.youtubeVideoId) return 0;
                if (playlistStatus === 'matching') return 1;
                return 2;
            };
            return order(a.track) - order(b.track);
        });

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <span className={styles.colNum}>#</span>
                <span className={styles.colTitle}>Title</span>
                <span className={styles.colArtist}>Artist</span>
                <span className={styles.colAlbum}>Album</span>
                <span className={styles.colDuration}>Duration</span>
            </div>
            <ul className={styles.list}>
                {sorted.map(({ track, originalIndex }) => {
                    const isActive = currentTrackId === track.id;
                    const state = trackState(track, playlistStatus);
                    const isAvailable = state === 'available';
                    const isMatching = state === 'matching';

                    const rowClass = [
                        styles.track,
                        isActive ? styles.active : '',
                        isMatching ? styles.trackMatching : '',
                        state === 'unavailable' ? styles.unavailable : '',
                    ].filter(Boolean).join(' ');

                    return (
                        <li
                            key={track.id || track.spotifyId || originalIndex}
                            className={rowClass}
                            onClick={() => isAvailable && onTrackSelect?.(track, originalIndex)}
                            title={
                                isMatching
                                    ? 'Finding a YouTube source…'
                                    : state === 'unavailable'
                                        ? 'No YouTube source found for this track'
                                        : undefined
                            }
                        >
                            <span className={styles.colNum}>
                                {isActive ? (
                                    <span className={styles.playingIcon}>
                                        <span /><span /><span />
                                    </span>
                                ) : (
                                    <>
                                        <span className={styles.trackNum}>{originalIndex + 1}</span>
                                        {isAvailable && (
                                            <svg
                                                className={styles.hoverPlay}
                                                viewBox="0 0 24 24"
                                                fill="currentColor"
                                                aria-hidden="true"
                                            >
                                                <path d="M8 5v14l11-7z" />
                                            </svg>
                                        )}
                                    </>
                                )}
                            </span>
                            <div className={styles.colTitle}>
                                <img
                                    className={styles.albumArt}
                                    src={track.albumImage || '/placeholder.png'}
                                    alt={track.album || 'Album art'}
                                    width={40}
                                    height={40}
                                />
                                <div className={styles.trackInfo}>
                                    <span className={styles.trackName}>{track.name}</span>
                                </div>
                            </div>
                            <span className={styles.colArtist}>
                                {track.artists?.join(', ') || 'Unknown Artist'}
                            </span>
                            <span className={styles.colAlbum}>{track.album || ''}</span>
                            <span className={styles.colDuration}>
                                {isAvailable ? (
                                    formatDuration(track.duration)
                                ) : isMatching ? (
                                    <span className={styles.matchingIndicator} aria-label="Matching in progress">
                                        <span className={styles.matchingDot} />
                                        <span className={styles.matchingDot} />
                                        <span className={styles.matchingDot} />
                                    </span>
                                ) : (
                                    <span className={styles.badgeUnavailable}>Not available</span>
                                )}
                            </span>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}
