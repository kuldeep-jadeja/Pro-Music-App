import { useState, useRef, useCallback, useEffect } from 'react';
import Link from 'next/link';
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
    onTrackChange,
    playlistId,
}) {
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [volume, setVolume] = useState(80);
    const [isReady, setIsReady] = useState(false);
    const [volumeOpen, setVolumeOpen] = useState(false);
    const playerRef = useRef(null);
    const intervalRef = useRef(null);
    const containerRef = useRef(null);

    // -----------------------------------------------------------------------
    // STALE CLOSURE FIX — refs for values read inside YT event handlers
    // -----------------------------------------------------------------------
    // The YT.Player instance (and its onStateChange / onError callbacks) is
    // created once and persists across re-renders.  The closures captured at
    // creation time would hold stale values of currentIndex / playlist /
    // onTrackChange.  By reading from refs instead, the handlers always see
    // the latest values regardless of when they were instantiated.
    // -----------------------------------------------------------------------
    const currentIndexRef = useRef(currentIndex);
    const playlistRef = useRef(playlist);
    const onTrackChangeRef = useRef(onTrackChange);

    useEffect(() => { currentIndexRef.current = currentIndex; }, [currentIndex]);
    useEffect(() => { playlistRef.current = playlist; }, [playlist]);
    useEffect(() => { onTrackChangeRef.current = onTrackChange; }, [onTrackChange]);

    // Load YouTube IFrame API
    useEffect(() => {
        if (window.YT && window.YT.Player) return;

        const tag = document.createElement('script');
        tag.src = 'https://www.youtube.com/iframe_api';
        document.head.appendChild(tag);

        window.onYouTubeIframeAPIReady = () => {
            // API loaded, will init on track change
        };
    }, []);

    // Initialize or update player when track changes
    useEffect(() => {
        if (!track?.youtubeVideoId) return;

        const initPlayer = () => {
            if (playerRef.current) {
                playerRef.current.loadVideoById(track.youtubeVideoId);
                return;
            }

            playerRef.current = new window.YT.Player('yt-player', {
                // iOS Safari requires non-zero dimensions on the iframe
                // (display:none / 0×0 silently blocks audio on WebKit).
                height: '1',
                width: '1',
                videoId: track.youtubeVideoId,
                playerVars: {
                    autoplay: 1,
                    playsinline: 1, // Required for inline playback on iOS
                    controls: 0,
                    disablekb: 1,
                    fs: 0,
                    modestbranding: 1,
                    rel: 0,
                    origin: typeof window !== 'undefined' ? window.location.origin : '',
                },
                events: {
                    onReady: (event) => {
                        setIsReady(true);
                        event.target.setVolume(volume);
                        // iOS Safari blocks playVideo() calls that happen
                        // outside a user-gesture callstack (onReady fires
                        // asynchronously and is NOT in a gesture context).
                        // Calling it here on iOS silently fails, leaving the
                        // player in an ambiguous state that causes the first
                        // tap on the play button to appear to do nothing.
                        // On desktop (Chrome / Firefox / desktop Safari) the
                        // call works fine — autoplay is permitted.
                        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
                        if (!isIOS) {
                            event.target.playVideo();
                        }
                    },
                    onStateChange: (event) => {
                        const state = event.data;
                        if (state === window.YT.PlayerState.PLAYING) {
                            setIsPlaying(true);
                            setDuration(event.target.getDuration());
                            startTimeTracking();
                        } else if (state === window.YT.PlayerState.PAUSED) {
                            setIsPlaying(false);
                            stopTimeTracking();
                        } else if (state === window.YT.PlayerState.ENDED) {
                            setIsPlaying(false);
                            stopTimeTracking();
                            handleNext();
                        }
                    },
                    onError: () => {
                        console.error('YouTube player error for:', track.name);
                        // Auto-skip to next on error
                        handleNext();
                    },
                },
            });
        };

        if (window.YT && window.YT.Player) {
            initPlayer();
        } else {
            // Wait for API to load
            const checkInterval = setInterval(() => {
                if (window.YT && window.YT.Player) {
                    clearInterval(checkInterval);
                    initPlayer();
                }
            }, 100);
            return () => clearInterval(checkInterval);
        }
    }, [track?.youtubeVideoId]);

    const startTimeTracking = useCallback(() => {
        stopTimeTracking();
        intervalRef.current = setInterval(() => {
            if (playerRef.current?.getCurrentTime) {
                setCurrentTime(playerRef.current.getCurrentTime());
            }
        }, 500);
    }, []);

    const stopTimeTracking = useCallback(() => {
        if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
        }
    }, []);

    // Cleanup on unmount
    useEffect(() => {
        return () => stopTimeTracking();
    }, [stopTimeTracking]);

    const togglePlay = () => {
        if (!playerRef.current) return;
        try {
            // Read state DIRECTLY from the player instead of relying on the
            // React `isPlaying` state variable.  On iOS the player can be in
            // UNSTARTED (-1) or PAUSED (2) before the user's first gesture,
            // and the React state may not yet reflect those transitions.
            // getPlayerState() always returns the live value.
            const state = playerRef.current.getPlayerState();
            if (state === 1 /* YT.PlayerState.PLAYING */) {
                playerRef.current.pauseVideo();
            } else {
                playerRef.current.playVideo();
            }
        } catch {
            // Fallback if getPlayerState throws (e.g. iframe not ready)
            playerRef.current.playVideo();
        }
    };

    const handleSeek = (e) => {
        if (!playerRef.current || !duration) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const pct = (e.clientX - rect.left) / rect.width;
        const seekTo = pct * duration;
        playerRef.current.seekTo(seekTo, true);
        setCurrentTime(seekTo);
    };

    const handleVolumeChange = (e) => {
        const val = parseInt(e.target.value, 10);
        setVolume(val);
        if (playerRef.current?.setVolume) {
            playerRef.current.setVolume(val);
        }
    };

    // handlePrev / handleNext read from refs so they always use the latest
    // currentIndex and playlist, even when called from stale YT event closures.
    const handlePrev = useCallback(() => {
        const pl = playlistRef.current;
        const idx = currentIndexRef.current;
        if (!pl || idx <= 0) return;
        // Find previous track with YouTube match
        for (let i = idx - 1; i >= 0; i--) {
            if (pl[i]?.youtubeVideoId) {
                onTrackChangeRef.current?.(pl[i], i);
                return;
            }
        }
    }, []);

    const handleNext = useCallback(() => {
        const pl = playlistRef.current;
        const idx = currentIndexRef.current;
        if (!pl || idx >= pl.length - 1) return;
        // Find next track with YouTube match
        for (let i = idx + 1; i < pl.length; i++) {
            if (pl[i]?.youtubeVideoId) {
                onTrackChangeRef.current?.(pl[i], i);
                return;
            }
        }
    }, []);

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
        <div className={styles.player} ref={containerRef}>
            {/* YouTube player container.
                 MUST NOT use display:none or visibility:hidden on iOS Safari —
                 WebKit silently blocks audio playback from invisible elements.
                 1×1px + opacity:0 keeps it accessible to the media engine
                 while remaining invisible to the user. */}
            <div id="yt-player" style={{
                position: 'fixed',
                width: '1px',
                height: '1px',
                opacity: 0,
                top: 0,
                left: 0,
                pointerEvents: 'none',
                zIndex: -1,
            }} />

            {/* Track Info */}
            <div className={styles.trackInfo}>
                {playlistId ? (
                    <Link href={`/playlist/${playlistId}`} className={styles.albumArtLink} title="Go to playlist">
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
            </div>

            {/* Controls */}
            <div className={styles.controls}>
                <div className={styles.buttons}>
                    <button
                        className={styles.controlBtn}
                        onClick={handlePrev}
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
                        onClick={handleNext}
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

            {/* Volume — desktop slider + mobile overlay toggle */}
            <div className={styles.volume}>
                {/* Desktop slider */}
                <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
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
        </div>
    );
}
