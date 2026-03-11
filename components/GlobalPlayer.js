import { useEffect, useRef, useCallback } from 'react';
import { usePlayer } from '@/context/PlayerContext';
import { resumeSilentAudio, resumeAudioContext } from '@/lib/unlockAudio';

/**
 * GlobalPlayer — Persistent YouTube IFrame + HTML5 <audio> element
 *
 * Mounted ONCE in _app.js so both players survive page navigation.
 *
 * ─── Dual Player Architecture ─────────────────────────────────────────
 * PRIMARY:  HTML5 <audio> element — plays direct audio URLs extracted by
 *           the server. Supports background playback on iOS and Android
 *           natively (the browser keeps top-level <audio> alive).
 *
 * FALLBACK: YT.Player iframe — used when the server cannot extract an
 *           audio URL. Works for foreground playback only.
 *
 * ─── iOS Safari Constraints ───────────────────────────────────────────
 * Safari on iOS blocks media elements hidden with display:none or
 * visibility:hidden. Both the <audio> element and the YT iframe must
 * remain in the DOM with real dimensions.
 * ──────────────────────────────────────────────────────────────────────
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
    const handleVisibilityChange = useCallback(() => {
        if (typeof document === 'undefined') return;

        if (document.visibilityState === 'visible') {
            // Page returning to foreground — resume keep-alive
            resumeSilentAudio();
            resumeAudioContext();

            // If HTML5 audio was playing and got interrupted, resume it
            setTimeout(() => {
                if (!wasPlayingRef.current) return;

                if (activePlayerRef.current === 'audio' && audioElRef.current) {
                    if (audioElRef.current.paused) {
                        audioElRef.current.play().catch(() => { });
                    }
                } else if (activePlayerRef.current === 'youtube' && playerRef.current) {
                    try {
                        const state = playerRef.current.getPlayerState();
                        if (state !== 1 && state !== 0) {
                            playerRef.current.playVideo();
                        }
                    } catch { }
                }
            }, 300);
        } else {
            // Page going to background — record state and keep audio alive
            try {
                if (activePlayerRef.current === 'audio' && audioElRef.current) {
                    if (!audioElRef.current.paused) {
                        wasPlayingRef.current = true;
                    }
                } else if (activePlayerRef.current === 'youtube' && playerRef.current) {
                    const state = playerRef.current.getPlayerState();
                    if (state === 1) {
                        wasPlayingRef.current = true;
                    }
                }
            } catch { }

            resumeSilentAudio();
        }
    }, [playerRef, audioElRef, wasPlayingRef, activePlayerRef]);

    useEffect(() => {
        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    }, [handleVisibilityChange]);

    return (
        <>
            {/* HTML5 <audio> element — PRIMARY player for background playback */}
            <audio
                ref={htmlAudioRef}
                playsInline
                webkit-playsinline=""
                preload="auto"
                style={{ position: 'fixed', width: 0, height: 0, opacity: 0 }}
            />

            {/* YouTube IFrame — FALLBACK player */}
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
