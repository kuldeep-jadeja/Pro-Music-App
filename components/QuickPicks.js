import { useRouter } from 'next/router';
import styles from '@/styles/QuickPicks.module.scss';

function formatDuration(ms) {
    if (!ms) return '';
    const totalSec = Math.floor(ms / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${min}:${sec.toString().padStart(2, '0')}`;
}

function PlayIcon() {
    return (
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
            <path d="M8 5v14l11-7z" />
        </svg>
    );
}

function PauseIcon() {
    return (
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
            <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
        </svg>
    );
}

/**
 * QuickPicks — horizontal shelf of playable tracks from the active playlist.
 * Shown on the home page between the greeting and import card.
 */
export default function QuickPicks({ playlist, tracks, currentTrack, onTrackSelect }) {
    const router = useRouter();

    // Only render if there's an active playlist with playable tracks
    const playable = tracks?.filter(t => t.youtubeVideoId) ?? [];
    if (!playlist || playable.length === 0) return null;

    // Show up to 12 tracks in the shelf
    const displayTracks = playable.slice(0, 12);

    return (
        <section className={styles.section} aria-label="Quick Picks">
            <div className={styles.header}>
                <div className={styles.headerLeft}>
                    <h2 className={styles.title}>Quick Picks</h2>
                    <span className={styles.subtitle}>
                        From{' '}
                        <button
                            className={styles.playlistLink}
                            onClick={() => router.push(`/playlist/${playlist.id}`)}
                        >
                            {playlist.name}
                        </button>
                    </span>
                </div>
                <button
                    className={styles.showAll}
                    onClick={() => router.push(`/playlist/${playlist.id}`)}
                    aria-label={`View all tracks in ${playlist.name}`}
                >
                    Show all
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
                        <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6z" />
                    </svg>
                </button>
            </div>

            <div className={styles.rail} role="list">
                {displayTracks.map((track, idx) => {
                    const isActive = currentTrack?.id === track.id || currentTrack?._id === track._id;
                    return (
                        <button
                            key={track.id ?? track._id}
                            role="listitem"
                            className={`${styles.card} ${isActive ? styles.cardActive : ''}`}
                            onClick={() => onTrackSelect(track, idx)}
                            aria-label={`Play ${track.name} by ${track.artists?.join(', ')}`}
                        >
                            <div className={styles.artWrap}>
                                {track.albumImage ? (
                                    <img
                                        src={track.albumImage}
                                        alt=""
                                        className={styles.art}
                                        loading="lazy"
                                        width={120}
                                        height={120}
                                    />
                                ) : (
                                    <div className={styles.artFallback} aria-hidden="true">
                                        <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor">
                                            <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
                                        </svg>
                                    </div>
                                )}
                                <div className={styles.playOverlay} aria-hidden="true">
                                    {isActive ? <PauseIcon /> : <PlayIcon />}
                                </div>
                            </div>

                            <div className={styles.meta}>
                                <span className={styles.trackName}>{track.name}</span>
                                <span className={styles.trackArtist}>
                                    {track.artists?.join(', ')}
                                </span>
                                {track.duration && (
                                    <span className={styles.trackDuration}>
                                        {formatDuration(track.duration)}
                                    </span>
                                )}
                            </div>
                        </button>
                    );
                })}
            </div>
        </section>
    );
}
