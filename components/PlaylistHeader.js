import styles from '@/styles/Playlist.module.scss';
import MatchProgressBar from '@/components/MatchProgressBar';

/**
 * PlaylistHeader — shared header used by the playlist page and (optionally)
 * the home page inline playlist view. Renders cover art, meta info,
 * play/shuffle actions, YouTube-match progress, and status pill.
 *
 * Props:
 *   playlist       — the active playlist object
 *   tracks         — full track array (used for match-count calculation)
 *   loadingTracks  — boolean; suppresses actions while tracks are loading
 *   onPlayAll      — callback fired when "Play" is clicked
 *   onShuffle      — callback fired when "Shuffle" is clicked
 */
export default function PlaylistHeader({
    playlist,
    tracks,
    loadingTracks,
    onPlayAll,
    onShuffle,
}) {
    if (!playlist) return null;

    const playableTracks = tracks?.filter((t) => t.youtubeVideoId) ?? [];
    const matchedCount = !loadingTracks && tracks?.length > 0
        ? tracks.filter((t) => t.youtubeVideoId).length
        : 0;
    const matchPct = tracks?.length > 0
        ? Math.round((matchedCount / tracks.length) * 100)
        : 0;

    return (
        <div className={styles.header}>
            {playlist.coverImage && (
                <div
                    className={styles.headerBg}
                    style={{ backgroundImage: `url(${playlist.coverImage})` }}
                    aria-hidden="true"
                />
            )}
            <div className={styles.headerBgOverlay} aria-hidden="true" />

            <div className={styles.headerContent}>
                {/* Cover art */}
                <div className={styles.artWrap}>
                    {playlist.coverImage ? (
                        <img
                            src={playlist.coverImage}
                            alt={playlist.name}
                            className={styles.cover}
                        />
                    ) : (
                        <div className={styles.artPlaceholder}>
                            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                                <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
                            </svg>
                        </div>
                    )}
                </div>

                {/* Text meta */}
                <div className={styles.meta}>
                    <span className={styles.label}>Playlist</span>
                    <h1 className={styles.name}>{playlist.name}</h1>
                    <p className={styles.desc}>
                        {playlist.owner}&nbsp;&middot;&nbsp;{playlist.trackCount} tracks
                    </p>

                    {/* Play / Shuffle actions */}
                    {!loadingTracks && playableTracks.length > 0 && (
                        <div className={styles.actions}>
                            <button className={styles.playAllBtn} onClick={onPlayAll}>
                                <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
                                    <path d="M8 5v14l11-7z" />
                                </svg>
                                Play
                            </button>
                            <button className={styles.shuffleBtn} onClick={onShuffle}>
                                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
                                    <path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z" />
                                </svg>
                                Shuffle
                            </button>
                        </div>
                    )}

                    {/* YouTube match progress */}
                    {!loadingTracks && tracks?.length > 0 && (
                        <MatchProgressBar matched={matchedCount} total={tracks.length} />
                    )}

                    {/* Import status pill */}
                    {playlist.status !== 'ready' && (
                        <span
                            className={`${styles.statusPill} ${styles[`status_${playlist.status}`] ?? ''}`}
                        >
                            {playlist.status === 'matching'
                                ? 'Finding YouTube matches…'
                                : playlist.status === 'paused'
                                    ? 'Paused — rate limited'
                                    : playlist.status === 'error'
                                        ? 'Error'
                                        : playlist.status}
                        </span>
                    )}
                </div>
            </div>
        </div>
    );
}
