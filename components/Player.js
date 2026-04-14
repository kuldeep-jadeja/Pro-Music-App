import { useState } from 'react';
import Link from 'next/link';
import { usePlayer } from '@/context/PlayerContext';
import styles from '@/styles/Player.module.scss';

/**
 * Format seconds to M:SS
 */
function formatTime(seconds) {
    if (!seconds || isNaN(seconds)) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function Player({
    track,
    playlist,
    currentIndex,
    playlistId,
    onOpenSheet,
}) {
    const {
        isPlaying,
        currentTime,
        duration,
        volume,
        togglePlay,
        seek,
        setVolume: setPlayerVolume,
        playNext,
        playPrevious,
        isShuffleOn,
        repeatMode,
        toggleShuffle,
        cycleRepeat,
    } = usePlayer();

    const [volumeOpen, setVolumeOpen] = useState(false);



    const handleSeek = (e) => {
        if (!duration) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const pct = (e.clientX - rect.left) / rect.width;
        seek(pct * duration);
    };

    const handleVolumeChange = (e) => {
        setPlayerVolume(parseInt(e.target.value, 10));
    };

    if (!track) {
        return (
            <div className={`${styles.player} ${styles.playerEmpty}`}>
                <svg className={styles.emptyIcon} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" width="20" height="20">
                    <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
                </svg>
                <span className={styles.empty}>Select a track to start listening</span>
            </div>
        );
    }

    const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0;

    return (
        <div className={styles.player}>
            {/* Mobile progress strip — thin accent line at top of player pill */}
            <div className={styles.mobileProgress} aria-hidden="true">
                <div
                    className={styles.mobileProgressFill}
                    style={{ width: `${progressPct}%` }}
                />
            </div>

            {/* Track Info — tappable on mobile to open the full Now Playing sheet */}
            <div
                className={`${styles.trackInfo}${onOpenSheet ? ` ${styles.trackInfoTap}` : ''}`}
                onClick={onOpenSheet}
                role={onOpenSheet ? 'button' : undefined}
                tabIndex={onOpenSheet ? 0 : undefined}
                aria-label={onOpenSheet ? `Open now playing: ${track.name}` : undefined}
                onKeyDown={onOpenSheet ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenSheet(); } } : undefined}
            >
                {playlistId ? (
                    <Link
                        href={`/playlist/${playlistId}`}
                        className={styles.albumArtLink}
                        title="Go to playlist"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <img
                            className={styles.albumArt}
                            src={track.albumImage || '/placeholder.png'}
                            alt={track.album || 'Album'}
                            width={56}
                            height={56}
                        />
                    </Link>
                ) : (
                    <img
                        className={styles.albumArt}
                        src={track.albumImage || '/placeholder.png'}
                        alt={track.album || 'Album'}
                        width={56}
                        height={56}
                    />
                )}
                <div className={styles.meta}>
                    <span className={styles.trackName}>{track.name}</span>
                    <span className={styles.artistName}>
                        {track.artists?.join(', ')}
                    </span>
                </div>
                {/* Mobile-only expand chevron */}
                {onOpenSheet && (
                    <svg className={styles.expandChevron} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" width="16" height="16">
                        <path d="M7.41 15.41 12 10.83l4.59 4.58L18 14l-6-6-6 6 1.41 1.41z" />
                    </svg>
                )}
            </div>

            {/* Controls — buttons only; progress bar is a sibling grid item */}
            <div className={styles.controls}>
                <div className={styles.buttons}>
                    {/* Shuffle */}
                    <button
                        className={`${styles.controlBtn} ${isShuffleOn ? styles.controlBtnActive : ''}`}
                        onClick={toggleShuffle}
                        title={isShuffleOn ? 'Shuffle on' : 'Shuffle off'}
                        aria-pressed={isShuffleOn}
                    >
                        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                            <path d="M10.59 9.17 5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z" />
                        </svg>
                    </button>

                    <button
                        className={styles.controlBtnMobile}
                        onClick={playPrevious}
                        disabled={currentIndex <= 0}
                        title="Previous"
                    >
                        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                            <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
                        </svg>
                    </button>
                    <button
                        className={styles.playBtn}
                        onClick={togglePlay}
                        title={isPlaying ? 'Pause' : 'Play'}
                    >
                        {isPlaying ? (
                            <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
                                <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                            </svg>
                        ) : (
                            <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
                                <path d="M8 5v14l11-7z" />
                            </svg>
                        )}
                    </button>
                    <button
                        className={styles.controlBtnMobile}
                        onClick={playNext}
                        disabled={!playlist || currentIndex >= playlist.length - 1}
                        title="Next"
                    >
                        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                            <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
                        </svg>
                    </button>

                    {/* Repeat */}
                    <button
                        className={`${styles.controlBtn} ${repeatMode !== 'off' ? styles.controlBtnActive : ''}`}
                        onClick={cycleRepeat}
                        title={repeatMode === 'one' ? 'Repeat one' : repeatMode === 'all' ? 'Repeat all' : 'Repeat off'}
                        aria-label={`Repeat: ${repeatMode}`}
                    >
                        {repeatMode === 'one' ? (
                            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                                <path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4zm-4-2V9h-1l-2 1v1h1.5v4H13z" />
                            </svg>
                        ) : (
                            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                                <path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z" />
                            </svg>
                        )}
                    </button>
                </div>
            </div>

            {/* Volume — desktop slider + mobile overlay toggle */}
            <div className={styles.volume}>
                {/* Desktop slider */}
                <svg className={styles.volumeIcon} viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
                    <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z" />
                </svg>
                <input
                    type="range"
                    min="0"
                    max="100"
                    value={volume}
                    onChange={handleVolumeChange}
                    className={styles.volumeSlider}
                    aria-label="Volume"
                />

                {/* Mobile volume button */}
                <button
                    className={styles.volumeBtn}
                    onClick={() => setVolumeOpen((o) => !o)}
                    aria-label="Volume"
                    aria-expanded={volumeOpen}
                >
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
                        <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z" />
                    </svg>
                </button>

                {/* Mobile vertical slider overlay */}
                {volumeOpen && (
                    <div className={styles.volumeOverlay}>
                        <input
                            type="range"
                            min="0"
                            max="100"
                            value={volume}
                            onChange={handleVolumeChange}
                            className={styles.volumeOverlaySlider}
                            aria-label="Volume"
                            orient="vertical"
                        />
                        <span className={styles.volumeOverlayLabel}>{volume}%</span>
                    </div>
                )}
            </div>

            {/* Progress Bar — row 2 on mobile (full width), row 2 col 2 on desktop */}
            <div className={styles.progressRow}>
                <span className={styles.time}>{formatTime(currentTime)}</span>
                <div className={styles.progressBar} onClick={handleSeek}>
                    <div
                        className={styles.progressFill}
                        style={{ width: `${progressPct}%` }}
                    />
                </div>
                <span className={styles.time}>{formatTime(duration)}</span>
            </div>
        </div>
    );
}
