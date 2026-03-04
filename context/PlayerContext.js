import {
    createContext,
    useContext,
    useRef,
    useState,
    useCallback,
    useEffect,
} from 'react';
import { registerAudioUnlock } from '@/lib/unlockAudio';

// ─────────────────────────────────────────────────────────────────────────────
// PlayerContext — Global playback state & YouTube IFrame player management
//
// Architecture:
//   • A single YT.Player instance is created ONCE (in GlobalPlayer) and
//     reused across all tracks via player.loadVideoById().
//   • The iframe is NEVER destroyed/recreated when navigating pages because
//     the provider is mounted in _app.js.
//   • iOS Safari requires the iframe to remain in the DOM with non-zero
//     dimensions (opacity:0, 1×1px, position:absolute) — see GlobalPlayer.
//   • An "audio unlock" handler (lib/unlockAudio.js) runs on the first user
//     interaction to satisfy iOS's user-gesture requirement for media playback.
//
// Exposed API:
//   State:   queue, currentIndex, currentTrack, isPlaying, currentTime,
//            duration, volume, isReady, isLoading
//   Actions: play(videoId), playTrack(track, index, queue?), togglePlay(),
//            seek(seconds), setVolume(val), playNext(), playPrevious(),
//            setQueue(tracks), initPlayer(containerId)
// ─────────────────────────────────────────────────────────────────────────────

const PlayerContext = createContext(null);

export function PlayerProvider({ children }) {
    const playerRef = useRef(null);
    const intervalRef = useRef(null);

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

    // ── Refs for stale-closure prevention ─────────────────────────────────
    // The YT.Player callbacks (onStateChange, onError) are bound once at
    // creation time.  Reading state directly inside those closures would
    // capture stale values.  Refs always reflect the latest state.
    const queueRef = useRef(queue);
    const currentIndexRef = useRef(currentIndex);
    const volumeRef = useRef(volume);
    const playNextRef = useRef(null); // populated after playNext is defined

    useEffect(() => { queueRef.current = queue; }, [queue]);
    useEffect(() => { currentIndexRef.current = currentIndex; }, [currentIndex]);
    useEffect(() => { volumeRef.current = volume; }, [volume]);

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
            if (playerRef.current?.getCurrentTime) {
                setCurrentTime(playerRef.current.getCurrentTime());
            }
        }, 500);
    }, [stopTimeTracking]);

    // Cleanup on unmount
    useEffect(() => {
        return () => stopTimeTracking();
    }, [stopTimeTracking]);

    // ── Initialize YouTube player ─────────────────────────────────────────
    // Called ONCE from GlobalPlayer when its container div is mounted.
    // Creates the YT.Player instance that persists for the lifetime of the app.
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

                        // Register the iOS audio-unlock handler now that the
                        // player exists.  It fires on the first user gesture.
                        registerAudioUnlock(() => playerRef.current);
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
                        } else if (
                            state === window.YT.PlayerState.ENDED &&
                            playerRef.current?.getCurrentTime() > 2
                        ) {
                            playNextRef.current?.();
                        }
                    },
                    onError: (event) => {
                        console.warn('YouTube player error:', event.data);

                        // Only skip for permanent video errors
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
            // Poll until the IFrame API script has loaded
            const check = setInterval(() => {
                if (window.YT?.Player) {
                    clearInterval(check);
                    create();
                }
            }, 100);
        }
    }, [startTimeTracking, stopTimeTracking]);

    // ── Match a single track via the API ──────────────────────────────────
    // Checks MongoDB cache first; scrapes YouTube only on a cache miss.
    const matchTrack = useCallback(async (track) => {
        // Already matched (from batch import) — skip the network call
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

    // ── Play a video by ID ────────────────────────────────────────────────
    // Reuses the existing YT.Player — never destroys/recreates the iframe.
    const play = useCallback((videoId) => {
        if (!playerRef.current || !videoId) return;
        playerRef.current.loadVideoById(videoId);

        setTimeout(() => {
            try {
                playerRef.current.playVideo();
            } catch { }
        }, 200);
    }, []);

    // ── Play a track (with on-demand matching) ────────────────────────────
    const playTrack = useCallback(async (track, index, newQueue) => {
        if (newQueue) setQueueState(newQueue);

        setCurrentTrack(track);
        setCurrentIndex(index);
        setIsLoading(true);

        const videoId = await matchTrack(track);
        setIsLoading(false);

        if (videoId) {
            play(videoId);

            // ── Prefetch optimisation ─────────────────────────────
            // While the current track plays, silently resolve the next
            // track's youtubeId so it's cached in MongoDB when needed.
            const q = newQueue || queueRef.current;
            if (q[index + 1]) {
                matchTrack(q[index + 1]).catch(() => { /* non-critical */ });
            }
        }
    }, [matchTrack, play]);

    // ── Toggle play / pause ───────────────────────────────────────────────
    const togglePlay = useCallback(() => {
        if (!playerRef.current) return;
        try {
            // Read directly from the player to avoid stale isPlaying closure
            const state = playerRef.current.getPlayerState();
            if (state === 1 /* YT.PlayerState.PLAYING */) {
                playerRef.current.pauseVideo();
            } else {
                playerRef.current.playVideo();
            }
        } catch {
            playerRef.current.playVideo();
        }
    }, []);

    // ── Seek ──────────────────────────────────────────────────────────────
    const seek = useCallback((seconds) => {
        if (playerRef.current) {
            playerRef.current.seekTo(seconds, true);
            setCurrentTime(seconds);
        }
    }, []);

    // ── Volume ────────────────────────────────────────────────────────────
    const setVolume = useCallback((val) => {
        setVolumeState(val);
        if (playerRef.current?.setVolume) {
            playerRef.current.setVolume(val);
        }
    }, []);

    // ── Next / Previous ───────────────────────────────────────────────────
    const playNext = useCallback(() => {
        const q = queueRef.current;
        const idx = currentIndexRef.current;
        if (!q || idx >= q.length - 1) return;

        for (let i = idx + 1; i < q.length; i++) {
            playTrack(q[i], i);
            return;
        }
    }, [playTrack]);

    const playPrevious = useCallback(() => {
        const q = queueRef.current;
        const idx = currentIndexRef.current;
        if (!q || idx <= 0) return;

        for (let i = idx - 1; i >= 0; i--) {
            playTrack(q[i], i);
            return;
        }
    }, [playTrack]);

    // Keep ref in sync so the YT onStateChange closure can call the latest version
    useEffect(() => { playNextRef.current = playNext; }, [playNext]);

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

        // Initialisation (called by GlobalPlayer)
        initPlayer,
        playerRef,

        // Actions
        play,
        playTrack,
        togglePlay,
        seek,
        setVolume,
        playNext,
        playPrevious,
        setQueue,
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
