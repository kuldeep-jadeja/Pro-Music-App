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

export default function TrackList({ tracks, currentTrackId, onTrackSelect }) {
    if (!tracks || tracks.length === 0) {
        return <p className={styles.empty}>No tracks found.</p>;
    }

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <span className={styles.colNum}>#</span>
                <span className={styles.colTitle}>Title</span>
                <span className={styles.colAlbum}>Album</span>
                <span className={styles.colDuration}>Duration</span>
            </div>
            <ul className={styles.list}>
                {tracks.map((track, index) => {
                    const isActive = currentTrackId === track.id;
                    const hasYoutube = !!track.youtubeVideoId;

                    return (
                        <li
                            key={track.id || track.spotifyId || index}
                            className={`${styles.track} ${isActive ? styles.active : ''} ${!hasYoutube ? styles.unavailable : ''
                                }`}
                            onClick={() => hasYoutube && onTrackSelect?.(track, index)}
                        >
                            <span className={styles.colNum}>
                                {isActive ? (
                                    <span className={styles.playingIcon}>
                                        <span /><span /><span />
                                    </span>
                                ) : (
                                    index + 1
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
                                    <span className={styles.artistName}>
                                        {track.artists?.join(', ') || 'Unknown Artist'}
                                    </span>
                                </div>
                            </div>
                            <span className={styles.colAlbum}>{track.album || ''}</span>
                            <span className={styles.colDuration}>
                                {hasYoutube ? (
                                    formatDuration(track.duration)
                                ) : (
                                    <span className={styles.badge}>No match</span>
                                )}
                            </span>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}
