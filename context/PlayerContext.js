import {
    createContext,
    useContext,
    useRef,
    useState,
    useCallback,
    useEffect,
} from 'react';
import { registerAudioUnlock, resumeSilentAudio } from '@/lib/unlockAudio';

// ─────────────────────────────────────────────────────────────────────────────
// PlayerContext — Hybrid Playback Architecture
//
// Desktop browsers → YouTube IFrame player (zero server bandwidth)
// Mobile / PWA     → HTML5 <audio> with server-extracted audio URLs
//                    (supports background playback, lock screen controls)
// Fallback         → If audio extraction fails, fall back to YouTube IFrame
//
// Device detection:
//   isMobileDevice  — /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
//   isStandalone    — window.matchMedia('(display-mode: standalone)').matches
//   preferredPlayer — (isMobileDevice || isStandalone) ? 'audio' : 'youtube'
//
// Exposed API:
//   State:   queue, currentIndex, currentTrack, isPlaying, currentTime,
//            duration, volume, isReady, isLoading, activePlayer
//   Actions: playTrack(track, index, queue?), togglePlay(),
//            seek(seconds), setVolume(val), playNext(), playPrevious(),
//            setQueue(tracks), initPlayer(containerId), setAudioElement(el),
//            toggleShuffle(), cycleRepeat()
//   Modes:   isShuffleOn (bool), repeatMode ('off'|'all'|'one')
// ─────────────────────────────────────────────────────────────────────────────

const PlayerContext = createContext(null);

// ── Device detection (runs once on module load) ───────────────────────────
function detectPreferredPlayer() {
    if (typeof window === 'undefined') return 'youtube';

    const isMobileDevice = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    const isStandalone =
        window.matchMedia('(display-mode: standalone)').matches ||
        navigator.standalone === true;

    return (isMobileDevice || isStandalone) ? 'audio' : 'youtube';
}

export function PlayerProvider({ children }) {
    const playerRef = useRef(null);       // YT.Player instance
    const audioElRef = useRef(null);      // HTML5 <audio> element
    const intervalRef = useRef(null);
    const activePlayerRef = useRef(null); // 'audio' | 'youtube' | null
    const currentVideoIdRef = useRef(null); // for fallback on audio error

    // ── Device preference (computed once) ─────────────────────────────────
    const preferredPlayerRef = useRef('youtube');
    useEffect(() => {
        preferredPlayerRef.current = detectPreferredPlayer();
    }, []);

    // ── Playback state ────────────────────────────────────────────────────
    const [queue, setQueueState] = useState([]);
    const [currentIndex, setCurrentIndex] = useState(-1);
    const [currentTrack, setCurrentTrack] = useState(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [volume, setVolumeState] = useState(80);
    const [isReady, setIsReady] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [isShuffleOn, setIsShuffleOn] = useState(false);
    const [repeatMode, setRepeatMode] = useState('off');
    const [activePlayer, setActivePlayer] = useState(null); // 'audio' | 'youtube'

    // ── Refs for stale-closure prevention ─────────────────────────────────
    const queueRef = useRef(queue);
    const currentIndexRef = useRef(currentIndex);
    const volumeRef = useRef(volume);
    const isShuffleOnRef = useRef(false);
    const repeatModeRef = useRef('off');
    const shuffledOrderRef = useRef([]);
    const shufflePositionRef = useRef(0);
    const playNextRef = useRef(null);
    const playPreviousRef = useRef(null);
    const wasPlayingRef = useRef(false);

    useEffect(() => { queueRef.current = queue; }, [queue]);
    useEffect(() => { currentIndexRef.current = currentIndex; }, [currentIndex]);
    useEffect(() => { volumeRef.current = volume; }, [volume]);
    useEffect(() => { isShuffleOnRef.current = isShuffleOn; }, [isShuffleOn]);
    useEffect(() => { repeatModeRef.current = repeatMode; }, [repeatMode]);

    // ── Accept audio element from GlobalPlayer ────────────────────────────
    const setAudioElement = useCallback((el) => {
        audioElRef.current = el;
    }, []);

    // ── Time tracking ─────────────────────────────────────────────────────
    const stopTimeTracking = useCallback(() => {
        if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
        }
    }, []);

    const startTimeTracking = useCallback(() => {
        stopTimeTracking();
        intervalRef.current = setInterval(() => {
            let time = 0;

            if (activePlayerRef.current === 'audio' && audioElRef.current) {
                time = audioElRef.current.currentTime || 0;
            } else if (activePlayerRef.current === 'youtube' && playerRef.current?.getCurrentTime) {
                time = playerRef.current.getCurrentTime();
            }

            setCurrentTime(time);

            // Keep lock-screen position in sync
            if ('mediaSession' in navigator && navigator.mediaSession.metadata) {
                try {
                    let dur = 0;
                    if (activePlayerRef.current === 'audio' && audioElRef.current) {
                        dur = audioElRef.current.duration || 0;
                    } else if (activePlayerRef.current === 'youtube') {
                        dur = playerRef.current?.getDuration?.() || 0;
                    }
                    if (dur > 0 && isFinite(dur)) {
                        navigator.mediaSession.setPositionState({
                            duration: dur,
                            playbackRate: 1,
                            position: Math.min(time, dur),
                        });
                    }
                } catch { }
            }
        }, 1000);
    }, [stopTimeTracking]);

    useEffect(() => {
        return () => stopTimeTracking();
    }, [stopTimeTracking]);

    // ── Initialize YouTube player ─────────────────────────────────────────
    const initPlayer = useCallback((containerId) => {
        if (playerRef.current) return;

        const create = () => {
            playerRef.current = new window.YT.Player(containerId, {
                height: '1',
                width: '1',
                videoId: '',
                playerVars: {
                    autoplay: 1,
                    playsinline: 1,
                    controls: 0,
                    rel: 0,
                    origin: window.location.origin
                },
                events: {
                    onReady: () => {
                        setIsReady(true);
                        playerRef.current.setVolume(volumeRef.current);
                        registerAudioUnlock(() => playerRef.current);

                        // ── Media Session action handlers ──────────────────
                        // Registered ONCE. Each handler delegates to the
                        // currently active player (audio or youtube).
                        if ('mediaSession' in navigator) {
                            navigator.mediaSession.setActionHandler('play', () => {
                                if (activePlayerRef.current === 'audio' && audioElRef.current) {
                                    audioElRef.current.play().catch(() => { });
                                } else {
                                    playerRef.current?.playVideo();
                                }
                                resumeSilentAudio();
                            });
                            navigator.mediaSession.setActionHandler('pause', () => {
                                if (activePlayerRef.current === 'audio' && audioElRef.current) {
                                    audioElRef.current.pause();
                                } else {
                                    playerRef.current?.pauseVideo();
                                }
                            });
                            navigator.mediaSession.setActionHandler('nexttrack', () => {
                                playNextRef.current?.();
                            });
                            navigator.mediaSession.setActionHandler('previoustrack', () => {
                                playPreviousRef.current?.();
                            });
                            navigator.mediaSession.setActionHandler('seekbackward', (details) => {
                                const offset = details?.seekOffset || 10;
                                if (activePlayerRef.current === 'audio' && audioElRef.current) {
                                    audioElRef.current.currentTime = Math.max(audioElRef.current.currentTime - offset, 0);
                                } else {
                                    const time = playerRef.current?.getCurrentTime?.() || 0;
                                    playerRef.current?.seekTo(Math.max(time - offset, 0), true);
                                }
                            });
                            navigator.mediaSession.setActionHandler('seekforward', (details) => {
                                const offset = details?.seekOffset || 10;
                                if (activePlayerRef.current === 'audio' && audioElRef.current) {
                                    const dur = audioElRef.current.duration || 0;
                                    audioElRef.current.currentTime = Math.min(audioElRef.current.currentTime + offset, dur);
                                } else {
                                    const time = playerRef.current?.getCurrentTime?.() || 0;
                                    const dur = playerRef.current?.getDuration?.() || 0;
                                    playerRef.current?.seekTo(Math.min(time + offset, dur), true);
                                }
                            });
                            try {
                                navigator.mediaSession.setActionHandler('seekto', (details) => {
                                    if (details?.seekTime != null) {
                                        if (activePlayerRef.current === 'audio' && audioElRef.current) {
                                            audioElRef.current.currentTime = details.seekTime;
                                        } else {
                                            playerRef.current?.seekTo(details.seekTime, true);
                                        }
                                    }
                                });
                            } catch { /* seekto not supported in all browsers */ }
                        }
                    },
                    onStateChange: (event) => {
                        // Only handle YT state changes when youtube is the active player
                        if (activePlayerRef.current !== 'youtube') return;

                        const state = event.data;

                        if (state === window.YT.PlayerState.PLAYING) {
                            setIsPlaying(true);
                            wasPlayingRef.current = true;
                            const dur = event.target.getDuration();
                            setDuration(dur);
                            startTimeTracking();
                            resumeSilentAudio();

                            if ('mediaSession' in navigator) {
                                navigator.mediaSession.playbackState = 'playing';
                                try {
                                    navigator.mediaSession.setPositionState({
                                        duration: dur || 0,
                                        playbackRate: 1,
                                        position: Math.min(
                                            event.target.getCurrentTime?.() || 0,
                                            dur || 0
                                        ),
                                    });
                                } catch { }
                            }
                        } else if (state === window.YT.PlayerState.PAUSED) {
                            setIsPlaying(false);
                            stopTimeTracking();
                            // Only clear wasPlaying if page is visible
                            // (OS-suspended pause should NOT clear the flag)
                            if (typeof document === 'undefined' || document.visibilityState === 'visible') {
                                wasPlayingRef.current = false;
                            }
                            if ('mediaSession' in navigator) {
                                navigator.mediaSession.playbackState = 'paused';
                            }
                        } else if (
                            state === window.YT.PlayerState.ENDED &&
                            playerRef.current?.getCurrentTime() > 2
                        ) {
                            playNextRef.current?.();
                        }
                    },
                    onError: (event) => {
                        console.warn('YouTube player error:', event.data);
                        if ([100, 101, 150].includes(event.data)) {
                            playNextRef.current?.();
                        }
                    },
                },
            });
        };

        if (window.YT?.Player) {
            create();
        } else {
            const check = setInterval(() => {
                if (window.YT?.Player) {
                    clearInterval(check);
                    create();
                }
            }, 100);
        }
    }, [startTimeTracking, stopTimeTracking]);

    // ── Shuffle helpers ────────────────────────────────────────────────────
    const buildShuffledOrder = useCallback((q, startIdx) => {
        const indices = q.map((_, i) => i).filter(i => i !== startIdx);
        for (let i = indices.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [indices[i], indices[j]] = [indices[j], indices[i]];
        }
        return [startIdx, ...indices];
    }, []);

    const toggleShuffle = useCallback(() => {
        setIsShuffleOn(prev => {
            const next = !prev;
            if (next) {
                const order = buildShuffledOrder(queueRef.current, currentIndexRef.current);
                shuffledOrderRef.current = order;
                shufflePositionRef.current = 0;
            }
            return next;
        });
    }, [buildShuffledOrder]);

    const cycleRepeat = useCallback(() => {
        setRepeatMode(prev => {
            const modes = ['off', 'all', 'one'];
            const next = modes[(modes.indexOf(prev) + 1) % modes.length];
            repeatModeRef.current = next;
            return next;
        });
    }, []);

    // ── Clean player switching ─────────────────────────────────────────────
    // When switching audio → youtube: stop audio element
    const stopAudioPlayer = useCallback(() => {
        try {
            if (audioElRef.current) {
                audioElRef.current.pause();
                audioElRef.current.src = '';
            }
        } catch { }
    }, []);

    // When switching youtube → audio: stop YT iframe
    const stopYouTubePlayer = useCallback(() => {
        try {
            if (playerRef.current?.pauseVideo) {
                playerRef.current.pauseVideo();
            }
        } catch { }
    }, []);

    // ── Wire HTML5 <audio> events ─────────────────────────────────────────
    const setupAudioEvents = useCallback((audioEl, videoId) => {
        if (!audioEl) return;

        audioEl.onplay = () => {
            if (activePlayerRef.current !== 'audio') return;
            setIsPlaying(true);
            wasPlayingRef.current = true;
            startTimeTracking();
            if ('mediaSession' in navigator) {
                navigator.mediaSession.playbackState = 'playing';
            }
        };

        audioEl.onpause = () => {
            if (activePlayerRef.current !== 'audio') return;
            setIsPlaying(false);
            stopTimeTracking();
            if (typeof document === 'undefined' || document.visibilityState === 'visible') {
                wasPlayingRef.current = false;
            }
            if ('mediaSession' in navigator) {
                navigator.mediaSession.playbackState = 'paused';
            }
        };

        audioEl.ontimeupdate = () => {
            if (activePlayerRef.current !== 'audio') return;
            setCurrentTime(audioEl.currentTime || 0);
        };

        audioEl.onloadedmetadata = () => {
            if (activePlayerRef.current !== 'audio') return;
            const dur = audioEl.duration;
            if (dur && isFinite(dur)) {
                setDuration(dur);
            }
        };

        audioEl.onended = () => {
            if (activePlayerRef.current !== 'audio') return;
            playNextRef.current?.();
        };

        // ── TASK 7: Audio error → fallback to YouTube IFrame ──────────
        audioEl.onerror = () => {
            if (activePlayerRef.current !== 'audio') return;
            console.warn('HTML5 audio error — falling back to YouTube IFrame');

            // Fall back to YouTube IFrame for the current video
            const fallbackId = currentVideoIdRef.current;
            if (fallbackId && playerRef.current) {
                stopAudioPlayer();
                activePlayerRef.current = 'youtube';
                setActivePlayer('youtube');
                playerRef.current.loadVideoById(fallbackId);
                setTimeout(() => {
                    try { playerRef.current.playVideo(); } catch { }
                }, 200);
            } else {
                // No fallback possible — advance to next track
                playNextRef.current?.();
            }
        };
    }, [startTimeTracking, stopTimeTracking, stopAudioPlayer]);

    // ── Match a single track via the API ──────────────────────────────────
    const matchTrack = useCallback(async (track) => {
        if (track.youtubeVideoId) return track.youtubeVideoId;

        try {
            const res = await fetch('/api/match-youtube', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: track.name,
                    artist: track.artists?.[0] || 'Unknown',
                    trackId: track.id || track._id,
                }),
            });

            if (res.ok) {
                const data = await res.json();
                return data.youtubeId || null;
            }
        } catch (err) {
            console.error('Match track error:', err);
        }

        return null;
    }, []);

    // ── Fetch direct audio URL from server (mobile only) ──────────────────
    const fetchAudioUrl = useCallback(async (videoId) => {
        try {
            const res = await fetch(`/api/audio-url/${videoId}`);
            if (res.ok) {
                const data = await res.json();
                return data.audioUrl || null;
            }
        } catch (err) {
            console.warn('Audio URL fetch failed:', err);
        }
        return null;
    }, []);

    // ── Play via YouTube IFrame ───────────────────────────────────────────
    const playViaYouTube = useCallback((videoId) => {
        if (!playerRef.current || !videoId) return;

        stopAudioPlayer();

        activePlayerRef.current = 'youtube';
        setActivePlayer('youtube');
        playerRef.current.loadVideoById(videoId);

        setTimeout(() => {
            try { playerRef.current.playVideo(); } catch { }
        }, 200);
    }, [stopAudioPlayer]);

    // ── Play a track (HYBRID routing) ─────────────────────────────────────
    const playTrack = useCallback(async (track, index, newQueue) => {
        if (newQueue) setQueueState(newQueue);

        setCurrentTrack(track);
        setCurrentIndex(index);
        setIsLoading(true);

        const videoId = await matchTrack(track);
        if (!videoId) {
            setIsLoading(false);
            return;
        }

        // Store videoId for audio error fallback
        currentVideoIdRef.current = videoId;

        // ── Media Session metadata (set before playback) ──────────
        if ('mediaSession' in navigator) {
            const artworkSrc = track.albumImage
                || `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
            navigator.mediaSession.metadata = new MediaMetadata({
                title: track.name,
                artist: track.artists?.join(', ') || 'Unknown Artist',
                album: track.album || '',
                artwork: [
                    { src: artworkSrc, sizes: '96x96', type: 'image/jpeg' },
                    { src: artworkSrc, sizes: '128x128', type: 'image/jpeg' },
                    { src: artworkSrc, sizes: '192x192', type: 'image/jpeg' },
                    { src: artworkSrc, sizes: '256x256', type: 'image/jpeg' },
                    { src: artworkSrc, sizes: '384x384', type: 'image/jpeg' },
                    { src: artworkSrc, sizes: '512x512', type: 'image/jpeg' },
                ],
            });
        }

        // ── HYBRID DECISION ───────────────────────────────────────
        // Desktop → always use YouTube IFrame (zero bandwidth)
        // Mobile / PWA → try HTML5 <audio> first, fallback to IFrame
        const preferred = preferredPlayerRef.current;

        if (preferred === 'audio' && audioElRef.current) {
            // ── Mobile / PWA path: try server-extracted audio URL ──
            const audioUrl = await fetchAudioUrl(videoId);

            if (audioUrl) {
                stopYouTubePlayer();
                setIsLoading(false);

                activePlayerRef.current = 'audio';
                setActivePlayer('audio');
                setupAudioEvents(audioElRef.current, videoId);

                audioElRef.current.src = audioUrl;
                audioElRef.current.volume = volumeRef.current / 100;

                const playPromise = audioElRef.current.play();
                if (playPromise && typeof playPromise.catch === 'function') {
                    playPromise.catch(() => {
                        // HTML5 audio play failed — fall back to YouTube
                        console.warn('HTML5 audio play() failed, falling back to YouTube IFrame');
                        playViaYouTube(videoId);
                    });
                }
            } else {
                // Audio URL extraction failed — fall back to YouTube IFrame
                setIsLoading(false);
                playViaYouTube(videoId);
            }
        } else {
            // ── Desktop path: use YouTube IFrame directly ──────────
            setIsLoading(false);
            playViaYouTube(videoId);
        }

        // Keep the silent audio helper running for iOS
        resumeSilentAudio();

        // ── Prefetch: resolve the next track's youtubeId ──────────
        const q = newQueue || queueRef.current;
        if (q[index + 1]) {
            matchTrack(q[index + 1]).catch(() => { });
        }

        // ── Rebuild shuffled order on direct track selection ───────
        if (isShuffleOnRef.current) {
            const order = buildShuffledOrder(q, index);
            shuffledOrderRef.current = order;
            shufflePositionRef.current = 0;
        }
    }, [matchTrack, fetchAudioUrl, playViaYouTube, stopYouTubePlayer, setupAudioEvents, buildShuffledOrder]);

    // ── Toggle play / pause ───────────────────────────────────────────────
    const togglePlay = useCallback(() => {
        if (activePlayerRef.current === 'audio' && audioElRef.current) {
            if (audioElRef.current.paused) {
                audioElRef.current.play().catch(() => { });
            } else {
                audioElRef.current.pause();
            }
        } else if (playerRef.current) {
            try {
                const state = playerRef.current.getPlayerState();
                if (state === 1 /* PLAYING */) {
                    playerRef.current.pauseVideo();
                } else {
                    playerRef.current.playVideo();
                }
            } catch {
                playerRef.current.playVideo();
            }
        }
    }, []);

    // ── Seek ──────────────────────────────────────────────────────────────
    const seek = useCallback((seconds) => {
        if (activePlayerRef.current === 'audio' && audioElRef.current) {
            audioElRef.current.currentTime = seconds;
            setCurrentTime(seconds);
        } else if (playerRef.current) {
            playerRef.current.seekTo(seconds, true);
            setCurrentTime(seconds);
        }
    }, []);

    // ── Volume ────────────────────────────────────────────────────────────
    const setVolume = useCallback((val) => {
        setVolumeState(val);
        if (activePlayerRef.current === 'audio' && audioElRef.current) {
            audioElRef.current.volume = val / 100;
        }
        if (playerRef.current?.setVolume) {
            playerRef.current.setVolume(val);
        }
    }, []);

    // ── Next / Previous ───────────────────────────────────────────────────
    const playNext = useCallback(() => {
        const q = queueRef.current;
        const idx = currentIndexRef.current;
        const repeat = repeatModeRef.current;
        const shuffle = isShuffleOnRef.current;

        if (repeat === 'one') {
            if (q[idx]) playTrack(q[idx], idx);
            return;
        }

        if (shuffle) {
            const order = shuffledOrderRef.current;
            let nextPos = shufflePositionRef.current + 1;
            if (nextPos >= order.length) {
                if (repeat === 'all') {
                    nextPos = 0;
                } else {
                    return;
                }
            }
            shufflePositionRef.current = nextPos;
            const nextIdx = order[nextPos];
            playTrack(q[nextIdx], nextIdx);
            return;
        }

        for (let i = idx + 1; i < q.length; i++) {
            if (q[i].youtubeVideoId) {
                playTrack(q[i], i);
                return;
            }
        }

        if (repeat === 'all') {
            for (let i = 0; i < idx; i++) {
                if (q[i].youtubeVideoId) {
                    playTrack(q[i], i);
                    return;
                }
            }
        }
    }, [playTrack]);

    const playPrevious = useCallback(() => {
        const q = queueRef.current;
        const idx = currentIndexRef.current;
        const shuffle = isShuffleOnRef.current;

        if (shuffle) {
            const order = shuffledOrderRef.current;
            let prevPos = shufflePositionRef.current - 1;
            if (prevPos < 0) prevPos = order.length - 1;
            shufflePositionRef.current = prevPos;
            const prevIdx = order[prevPos];
            playTrack(q[prevIdx], prevIdx);
            return;
        }

        if (!q || idx <= 0) return;

        for (let i = idx - 1; i >= 0; i--) {
            if (q[i].youtubeVideoId) {
                playTrack(q[i], i);
                return;
            }
        }
    }, [playTrack]);

    useEffect(() => { playNextRef.current = playNext; }, [playNext]);
    useEffect(() => { playPreviousRef.current = playPrevious; }, [playPrevious]);

    // ── Public queue setter ───────────────────────────────────────────────
    const setQueue = useCallback((tracks) => {
        setQueueState(tracks);
    }, []);

    // ── Context value ─────────────────────────────────────────────────────
    const value = {
        // State
        queue,
        currentIndex,
        currentTrack,
        isPlaying,
        currentTime,
        duration,
        volume,
        isReady,
        isLoading,
        isShuffleOn,
        repeatMode,
        activePlayer,

        // Initialisation (called by GlobalPlayer)
        initPlayer,
        playerRef,
        wasPlayingRef,
        audioElRef,
        activePlayerRef,
        setAudioElement,

        // Actions
        play: playViaYouTube,
        playTrack,
        togglePlay,
        seek,
        setVolume,
        playNext,
        playPrevious,
        setQueue,
        toggleShuffle,
        cycleRepeat,

        // Modes
        isShuffleOn,
        repeatMode,
    };

    return (
        <PlayerContext.Provider value={value}>
            {children}
        </PlayerContext.Provider>
    );
}

/**
 * Hook — access the global player context.
 * Must be used inside a <PlayerProvider>.
 */
export function usePlayer() {
    const ctx = useContext(PlayerContext);
    if (!ctx) {
        throw new Error('usePlayer must be used within a <PlayerProvider>');
    }
    return ctx;
}
