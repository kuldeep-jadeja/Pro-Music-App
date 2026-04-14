import Link from 'next/link';
import styles from '@/styles/NowPlayingPanel.module.scss';

function CloseIcon() {
    return (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
        </svg>
    );
}

function MusicNoteIcon() {
    return (
        <svg viewBox="0 0 24 24" width="40" height="40" fill="currentColor" aria-hidden="true">
            <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
        </svg>
    );
}

function HeartIcon() {
    return (
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
            <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
        </svg>
    );
}

function ShareIcon() {
    return (
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
            <path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92 1.61 0 2.92-1.31 2.92-2.92s-1.31-2.92-2.92-2.92z" />
        </svg>
    );
}

function PlayingBarsIcon() {
    return (
        <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true" className={styles.playingBars}>
            <rect x="2" y="14" width="4" height="7" rx="1" />
            <rect x="9" y="8" width="4" height="13" rx="1" />
            <rect x="16" y="11" width="4" height="10" rx="1" />
        </svg>
    );
}

/**
 * NowPlayingPanel — fixed right-side panel showing current track + queue.
 * Only visible on screens ≥ $breakpoint-panel (1280px).
 * Hidden altogether when no track is playing and no active playlist.
 */
export default function NowPlayingPanel({
    currentTrack,
    playlist,       // tracks array
    currentIndex,
    activePlaylist, // playlist meta object { id, name, coverImage }
    onTrackSelect,
    onClose,
    isOpen,
}) {
    // Build queue: up to 5 upcoming tracks, then wrap around
    const upcoming = [];
    if (playlist?.length > 0 && currentIndex >= 0) {
        for (let i = 1; i <= 5; i++) {
            const idx = (currentIndex + i) % playlist.length;
            if (playlist[idx]?.youtubeVideoId) {
                upcoming.push({ track: playlist[idx], queueIndex: idx });
            }
        }
    }

    const hasContent = !!currentTrack || !!activePlaylist;

    return (
        <aside
            className={[
                styles.panel,
                isOpen ? styles.panelOpen : '',
                !hasContent ? styles.panelEmpty : '',
            ].filter(Boolean).join(' ')}
            aria-label="Now Playing"
        >
            {/* Header */}
            <div className={styles.panelHeader}>
                <span className={styles.panelTitle}>Now Playing</span>
                <button
                    className={styles.closeBtn}
                    onClick={onClose}
                    aria-label="Close Now Playing panel"
                >
                    <CloseIcon />
                </button>
            </div>

            {currentTrack ? (
                <>
                    {/* Album art */}
                    <div className={styles.artWrap}>
                        {currentTrack.albumImage ? (
                            <img
                                src={currentTrack.albumImage}
                                alt={`${currentTrack.name} album art`}
                                className={styles.art}
                                width={260}
                                height={260}
                            />
                        ) : (
                            <div className={styles.artFallback}>
                                <MusicNoteIcon />
                            </div>
                        )}
                        {/* Subtle vinyl groove animation when playing */}
                        <div className={styles.artShine} aria-hidden="true" />
                    </div>

                    {/* Track info */}
                    <div className={styles.trackInfo}>
                        <p className={styles.trackName}>{currentTrack.name}</p>
                        <p className={styles.trackArtist}>
                            {currentTrack.artists?.join(', ')}
                        </p>
                        {currentTrack.album && (
                            <p className={styles.trackAlbum}>{currentTrack.album}</p>
                        )}
                        {activePlaylist && (
                            <Link
                                href={`/playlist/${activePlaylist.id}`}
                                className={styles.fromPlaylist}
                            >
                                From &ldquo;{activePlaylist.name}&rdquo;
                            </Link>
                        )}
                    </div>

                    {/* Like / Share actions */}
                    <div className={styles.actions}>
                        <button className={styles.actionBtn} aria-label="Like track">
                            <HeartIcon />
                            Like
                        </button>
                        <button className={styles.actionBtn} aria-label="Share track">
                            <ShareIcon />
                            Share
                        </button>
                    </div>

                    {/* Queue */}
                    {upcoming.length > 0 && (
                        <div className={styles.queue}>
                            <p className={styles.queueLabel}>Up next</p>
                            <ul className={styles.queueList} role="list">
                                {upcoming.map(({ track, queueIndex }, i) => (
                                    <li key={track.id ?? track._id}>
                                        <button
                                            className={styles.queueItem}
                                            onClick={() => onTrackSelect(track, queueIndex)}
                                            aria-label={`Play ${track.name}`}
                                        >
                                            <span className={styles.queuePos}>{i + 1}</span>
                                            {track.albumImage ? (
                                                <img
                                                    src={track.albumImage}
                                                    alt=""
                                                    className={styles.queueArt}
                                                    width={40}
                                                    height={40}
                                                />
                                            ) : (
                                                <div className={styles.queueArtFallback} aria-hidden="true" />
                                            )}
                                            <div className={styles.queueMeta}>
                                                <span className={styles.queueName}>{track.name}</span>
                                                <span className={styles.queueArtist}>
                                                    {track.artists?.join(', ')}
                                                </span>
                                            </div>
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </>
            ) : (
                /* Empty state */
                <div className={styles.emptyState}>
                    <div className={styles.emptyIcon}>
                        <MusicNoteIcon />
                    </div>
                    <p className={styles.emptyTitle}>Nothing playing</p>
                    <p className={styles.emptyDesc}>
                        Pick a track from your library to start listening.
                    </p>
                    <Link href="/#playlists" className={styles.emptyBtn}>
                        Browse library →
                    </Link>
                </div>
            )}
        </aside>
    );
}
