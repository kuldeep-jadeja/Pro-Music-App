import { usePlayer } from '@/context/PlayerContext';
import styles from '@/styles/MobileNowPlayingSheet.module.scss';

function formatTime(sec) {
    if (!sec || isNaN(sec)) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
}

function PlayIcon() {
    return (
        <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor" aria-hidden="true">
            <path d="M8 5v14l11-7z" />
        </svg>
    );
}

function PauseIcon() {
    return (
        <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor" aria-hidden="true">
            <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
        </svg>
    );
}

function PrevIcon() {
    return (
        <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true">
            <path d="M6 6h2v12H6zm3.5 6 8.5 6V6z" />
        </svg>
    );
}

function NextIcon() {
    return (
        <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true">
            <path d="M6 18l8.5-6L6 6v12zm2.5-6 6-4.26v8.52L8.5 12zM16 6h2v12h-2z" />
        </svg>
    );
}

function ShuffleIcon() {
    return (
        <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
            <path d="M10.59 9.17 5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z" />
        </svg>
    );
}

function RepeatIcon() {
    return (
        <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
            <path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z" />
        </svg>
    );
}

function RepeatOneIcon() {
    return (
        <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
            <path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4zm-4-2V9h-1l-2 1v1h1.5v4H13z" />
        </svg>
    );
}

function MusicNoteIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
        </svg>
    );
}

export default function MobileNowPlayingSheet({ track, isOpen, onClose }) {
    const { isPlaying, currentTime, duration, togglePlay, seek, playNext, playPrevious, isShuffleOn, repeatMode, toggleShuffle, cycleRepeat } =
        usePlayer();

    if (!track) return null;

    const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

    const handleSeek = (e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        seek(pct * duration);
    };

    return (
        <>
            {isOpen && (
                <div className={styles.backdrop} onClick={onClose} aria-hidden="true" />
            )}
            <div
                className={`${styles.sheet}${isOpen ? ` ${styles.open}` : ''}`}
                role="dialog"
                aria-modal="true"
                aria-label="Now Playing"
            >
                {/* Drag handle doubles as close button */}
                <button className={styles.handle} onClick={onClose} aria-label="Close player">
                    <span className={styles.handleBar} />
                </button>

                {/* Album art */}
                <div className={styles.artWrap}>
                    {track.albumImage ? (
                        <img src={track.albumImage} alt={track.name} className={styles.art} />
                    ) : (
                        <div className={styles.artPlaceholder}>
                            <MusicNoteIcon />
                        </div>
                    )}
                </div>

                {/* Track info */}
                <div className={styles.meta}>
                    <p className={styles.name}>{track.name}</p>
                    <p className={styles.artist}>{track.artists?.join(', ')}</p>
                </div>

                {/* Seek bar */}
                <div className={styles.seekWrap}>
                    <div
                        className={styles.seekBar}
                        onClick={handleSeek}
                        onTouchStart={handleSeek}
                        role="slider"
                        aria-label="Seek"
                        aria-valuenow={Math.round(currentTime)}
                        aria-valuemin={0}
                        aria-valuemax={Math.round(duration) || 0}
                        tabIndex={0}
                    >
                        <div className={styles.seekFill} style={{ width: `${progress}%` }} />
                        <div className={styles.seekThumb} style={{ left: `calc(${progress}% - 6px)` }} />
                    </div>
                    <div className={styles.seekTimes}>
                        <span>{formatTime(currentTime)}</span>
                        <span>{formatTime(duration)}</span>
                    </div>
                </div>

                {/* Controls */}
                <div className={styles.controls}>
                    <button
                        className={`${styles.ctrlBtn} ${styles.ctrlBtnSm} ${isShuffleOn ? styles.ctrlBtnActive : ''}`}
                        onClick={toggleShuffle}
                        aria-label={isShuffleOn ? 'Shuffle on' : 'Shuffle off'}
                        aria-pressed={isShuffleOn}
                    >
                        <ShuffleIcon />
                    </button>
                    <button className={styles.ctrlBtn} onClick={playPrevious} aria-label="Previous track">
                        <PrevIcon />
                    </button>
                    <button
                        className={`${styles.ctrlBtn} ${styles.playPauseBtn}`}
                        onClick={togglePlay}
                        aria-label={isPlaying ? 'Pause' : 'Play'}
                    >
                        {isPlaying ? <PauseIcon /> : <PlayIcon />}
                    </button>
                    <button className={styles.ctrlBtn} onClick={playNext} aria-label="Next track">
                        <NextIcon />
                    </button>
                    <button
                        className={`${styles.ctrlBtn} ${styles.ctrlBtnSm} ${repeatMode !== 'off' ? styles.ctrlBtnActive : ''}`}
                        onClick={cycleRepeat}
                        aria-label={`Repeat: ${repeatMode}`}
                    >
                        {repeatMode === 'one' ? <RepeatOneIcon /> : <RepeatIcon />}
                    </button>
                </div>
            </div>
        </>
    );
}
