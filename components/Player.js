import { useCallback } from 'react';
import { usePlayer } from '@/context/PlayerContext';
import styles from '@/styles/Player.module.scss';

/**
 * Player — Bottom-bar playback UI
 *
 * All playback logic has been moved to PlayerContext. This component is
 * a pure UI shell that reads state from the global context and delegates
 * user interactions (play, pause, seek, next, prev, volume) to it.
 *
 * The YouTube IFrame player lives in GlobalPlayer (mounted in _app.js).
 * It is NEVER recreated here — only player.loadVideoById() is called.
 */

function formatTime(seconds) {
    if (!seconds || isNaN(seconds)) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function Player() {
    const {
        currentTrack: track,
        currentIndex,
        queue: playlist,
        isPlaying,
        currentTime,
        duration,
        volume,
        isLoading,
        togglePlay,
        seek,
        setVolume,
        playNext,
        playPrevious,
    } = usePlayer();

    const handleSeek = useCallback(
        (e) => {
            if (!duration) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const pct = (e.clientX - rect.left) / rect.width;
            seek(pct * duration);
        },
        [duration, seek],
    );

    const handleVolumeChange = useCallback(
        (e) => {
            setVolume(parseInt(e.target.value, 10));
        },
        [setVolume],
    );

    if (!track) {
        return (
            <div className={styles.player}>
                <div className={styles.empty}>
                    Select a track to start listening
                </div>
            </div>
        );
    }

    const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0;

    return (
        <div className={styles.player}>
            {/* YouTube player is mounted globally in GlobalPlayer —
                no hidden div needed here. iOS Safari requires the iframe
                to remain in the DOM with non-zero dimensions; that's handled
                by GlobalPlayer's 1×1px / opacity:0 wrapper. */}

            {/* Track Info */}
            <div className={styles.trackInfo}>
                <img
                    className={styles.albumArt}
                    src={track.albumImage || '/placeholder.png'}
                    alt={track.album || 'Album'}
                    width={56}
                    height={56}
                />
                <div className={styles.meta}>
                    <span className={styles.trackName}>
                        {track.name}
                        {isLoading && ' — Loading...'}
                    </span>
                    <span className={styles.artistName}>
                        {track.artists?.join(', ')}
                    </span>
                </div>
            </div>

            {/* Controls */}
            <div className={styles.controls}>
                <div className={styles.buttons}>
                    <button
                        className={styles.controlBtn}
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
                        className={styles.controlBtn}
                        onClick={playNext}
                        disabled={!playlist || currentIndex >= playlist.length - 1}
                        title="Next"
                    >
                        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                            <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
                        </svg>
                    </button>
                </div>

                {/* Progress Bar */}
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

            {/* Volume */}
            <div className={styles.volume}>
                <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                    <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z" />
                </svg>
                <input
                    type="range"
                    min="0"
                    max="100"
                    value={volume}
                    onChange={handleVolumeChange}
                    className={styles.volumeSlider}
                />
            </div>
        </div>
    );
}
