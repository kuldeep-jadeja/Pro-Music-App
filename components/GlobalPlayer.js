import { useEffect, useRef, useCallback } from 'react';
import { usePlayer } from '@/context/PlayerContext';
import { resumeSilentAudio, resumeAudioContext } from '@/lib/unlockAudio';

/**
 * GlobalPlayer — Persistent YouTube IFrame + HTML5 <audio> element
 *
 * Mounted ONCE in _app.js so both players survive page navigation.
 *
 * ─── Hybrid Playback Architecture ───────────────────────────────────
 * Desktop:  YouTube IFrame player (zero server bandwidth, unchanged)
 * Mobile:   HTML5 <audio> element with server-extracted audio URLs
 *           (supports background playback, lock screen controls)
 * Fallback: If audio extraction fails, uses YouTube IFrame
 *
 * Both elements remain mounted at all times. PlayerContext decides
 * which one to activate based on device detection.
 *
 * ─── iOS Safari Constraints ─────────────────────────────────────────
 * Safari blocks media elements hidden with display:none or
 * visibility:hidden. Both the <audio> element and the YT iframe
 * must remain in the DOM with non-zero dimensions.
 * ────────────────────────────────────────────────────────────────────
 */
export default function GlobalPlayer() {
    const { initPlayer, setAudioElement, playerRef, audioElRef, wasPlayingRef, activePlayerRef } = usePlayer();
    const scriptLoaded = useRef(false);
    const audioMounted = useRef(false);
    const htmlAudioRef = useRef(null);

    // ── Mount the HTML5 <audio> element ───────────────────────────────
    useEffect(() => {
        if (audioMounted.current || !htmlAudioRef.current) return;
        audioMounted.current = true;
        setAudioElement(htmlAudioRef.current);
    }, [setAudioElement]);

    // ── Load YouTube IFrame API ───────────────────────────────────────
    useEffect(() => {
        if (scriptLoaded.current) return;
        if (typeof window === 'undefined') return;
        scriptLoaded.current = true;

        if (window.YT?.Player) {
            initPlayer('youtube-player');
            return;
        }

        if (document.querySelector('script[src*="youtube.com/iframe_api"]')) {
            const prevCb = window.onYouTubeIframeAPIReady;
            window.onYouTubeIframeAPIReady = () => {
                prevCb?.();
                initPlayer('youtube-player');
            };
            return;
        }

        const tag = document.createElement('script');
        tag.src = 'https://www.youtube.com/iframe_api';
        tag.async = true;
        document.head.appendChild(tag);

        window.onYouTubeIframeAPIReady = () => {
            initPlayer('youtube-player');
        };
    }, [initPlayer]);

    // ── Visibility change handler ─────────────────────────────────────
    // Handles page background/foreground transitions for both players.
    const handleVisibilityChange = useCallback(() => {
        if (typeof document === 'undefined') return;

        if (document.visibilityState === 'visible') {
            // Page returning to foreground
            resumeSilentAudio();
            resumeAudioContext();

            {/* Resume playback if it was interrupted by the OS */}
            const resumePlayback = () => {
                if (!wasPlayingRef.current) return;

                if (activePlayerRef.current === 'audio' && audioElRef.current) {
                    // Do not check `paused` because iOS might have suspended the audio
                    // without firing the `pause` event immediately. Call play directly.
                    audioElRef.current.play().catch(() => { });
                } else if (activePlayerRef.current === 'youtube' && playerRef.current) {
                    try {
                        const state = playerRef.current.getPlayerState();
                        if (state !== 1 /* PLAYING */ && state !== 0 /* ENDED */) {
                            playerRef.current.playVideo();
                        }
                    } catch { }
                }
            };

            // On iOS, calling play() immediately after visibility returns is more reliable.
            resumePlayback();
        } else {
            // Page going to background — record current state
            try {
                if (activePlayerRef.current === 'audio' && audioElRef.current) {
                    if (!audioElRef.current.paused) {
                        wasPlayingRef.current = true;
                    }
                } else if (activePlayerRef.current === 'youtube' && playerRef.current) {
                    const state = playerRef.current.getPlayerState();
                    if (state === 1 /* PLAYING */) {
                        wasPlayingRef.current = true;
                    }
                }
            } catch { }

            // Keep silent audio alive for iOS
            resumeSilentAudio();
        }
    }, [playerRef, audioElRef, wasPlayingRef, activePlayerRef]);

    useEffect(() => {
        const handlePageShow = (e) => {
            if (e.persisted) handleVisibilityChange();
        };

        window.addEventListener('pageshow', handlePageShow);
        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => {
            window.removeEventListener('pageshow', handlePageShow);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, [handleVisibilityChange]);

    return (
        <>
            {/* HTML5 <audio> element — used on mobile/PWA for background playback */}
            <audio
                ref={htmlAudioRef}
                playsInline
                webkitPlaysInline
                preload="metadata"
                style={{ position: 'fixed', width: '1px', height: '1px', opacity: 0.01, pointerEvents: 'none' }}
            />

            {/* YouTube IFrame — used on desktop (and as fallback on mobile) */}
            <div
                style={{
                    position: 'fixed',
                    width: '1px',
                    height: '1px',
                    opacity: 0,
                    top: 0,
                    left: 0,
                    overflow: 'hidden',
                    pointerEvents: 'none',
                    zIndex: -1,
                }}
            >
                <div id="youtube-player" />
            </div>
        </>
    );
}
