import { useEffect, useRef, useCallback } from 'react';
import { usePlayer } from '@/context/PlayerContext';
import { resumeSilentAudio, resumeAudioContext } from '@/lib/unlockAudio';

/**
 * GlobalPlayer — Persistent YouTube IFrame player
 *
 * Mounted ONCE in _app.js so the iframe survives page navigation.
 * The YT.Player instance created here is shared via PlayerContext and
 * reused for every track via player.loadVideoById().
 *
 * ─── iOS Safari Constraints ───────────────────────────────────────────
 * Safari on iOS blocks media elements that are hidden with:
 *   • display: none
 *   • visibility: hidden
 *
 * The iframe MUST remain in the DOM with real (non-zero) dimensions.
 * We make it invisible to the user via:
 *   • width: 1px / height: 1px
 *   • opacity: 0
 *   • position: fixed  (out of flow)
 *   • pointer-events: none
 *
 * The `allow="autoplay; encrypted-media"` attribute on the iframe
 * (set automatically by the YT IFrame API) enables autoplay on
 * browsers that honour the Permissions-Policy header.
 * ──────────────────────────────────────────────────────────────────────
 */
export default function GlobalPlayer() {
    const { initPlayer, playerRef, wasPlayingRef } = usePlayer();
    const scriptLoaded = useRef(false);
    const wakeLockRef = useRef(null);

    useEffect(() => {
        if (scriptLoaded.current) return;
        if (typeof window === 'undefined') return;
        scriptLoaded.current = true;

        // ── Case 1: YT API already fully loaded ──────────────────
        if (window.YT?.Player) {
            initPlayer('youtube-player');
            return;
        }

        // ── Case 2: Script tag exists but API not ready yet ──────
        if (document.querySelector('script[src*="youtube.com/iframe_api"]')) {
            const prevCb = window.onYouTubeIframeAPIReady;
            window.onYouTubeIframeAPIReady = () => {
                prevCb?.();
                initPlayer('youtube-player');
            };
            return;
        }

        // ── Case 3: Load the script ourselves ────────────────────
        const tag = document.createElement('script');
        tag.src = 'https://www.youtube.com/iframe_api';
        tag.async = true;
        document.head.appendChild(tag);

        window.onYouTubeIframeAPIReady = () => {
            initPlayer('youtube-player');
        };
    }, [initPlayer]);

    // ── Wake Lock helpers ─────────────────────────────────────────────
    // The Screen Wake Lock API prevents the OS from suspending the tab
    // while audio is playing. Supported on Android Chrome 84+.
    // Not supported on iOS Safari — the silent audio workaround covers iOS.
    const requestWakeLock = useCallback(async () => {
        try {
            if ('wakeLock' in navigator && !wakeLockRef.current) {
                wakeLockRef.current = await navigator.wakeLock.request('screen');
                wakeLockRef.current.addEventListener('release', () => {
                    wakeLockRef.current = null;
                });
            }
        } catch {
            // Wake Lock request failed (e.g. low battery, not supported)
        }
    }, []);

    const releaseWakeLock = useCallback(() => {
        try {
            if (wakeLockRef.current) {
                wakeLockRef.current.release();
                wakeLockRef.current = null;
            }
        } catch { }
    }, []);

    // ── Visibility change handler ─────────────────────────────────────
    // When the page returns to the foreground, resume all keep-alive
    // mechanisms and recover playback if it was interrupted by the OS.
    const handleVisibilityChange = useCallback(() => {
        if (typeof document === 'undefined') return;

        if (document.visibilityState === 'visible') {
            // ── Page returning to foreground ──────────────────────

            // 1. Resume silent audio + AudioContext keep-alive
            resumeSilentAudio();
            resumeAudioContext();

            // 2. Re-acquire Wake Lock (it's released when page goes hidden)
            requestWakeLock();

            // 3. Check if playback was interrupted by the OS
            //    Give the YT player a moment to settle after page return
            setTimeout(() => {
                const player = playerRef.current;
                if (!player || !wasPlayingRef.current) return;

                try {
                    const state = player.getPlayerState();
                    // YT states: -1=unstarted, 0=ended, 1=playing, 2=paused, 3=buffering, 5=cued
                    // If we were playing but now we're paused/buffering/cued, resume
                    if (state !== 1 /* PLAYING */ && state !== 0 /* ENDED */) {
                        player.playVideo();
                    }
                } catch { }
            }, 300);
        } else {
            // ── Page going to background ─────────────────────────
            // Record whether we were playing so we can resume on return.
            // wasPlayingRef is updated by PlayerContext's onStateChange,
            // but we also set it here as a safety net.
            try {
                const player = playerRef.current;
                if (player) {
                    const state = player.getPlayerState();
                    if (state === 1 /* PLAYING */) {
                        wasPlayingRef.current = true;
                    }
                }
            } catch { }

            // Keep the silent audio running — do NOT pause it
            resumeSilentAudio();
        }
    }, [playerRef, wasPlayingRef, requestWakeLock]);

    useEffect(() => {
        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    }, [handleVisibilityChange]);

    // ── Acquire/release Wake Lock based on playback state ─────────────
    // We observe the wasPlayingRef to know when to toggle the lock.
    // This is driven by a periodic check since wasPlayingRef is a ref.
    useEffect(() => {
        const checkInterval = setInterval(() => {
            if (wasPlayingRef.current && !wakeLockRef.current) {
                requestWakeLock();
            } else if (!wasPlayingRef.current && wakeLockRef.current) {
                releaseWakeLock();
            }
        }, 3000);

        return () => {
            clearInterval(checkInterval);
            releaseWakeLock();
        };
    }, [wasPlayingRef, requestWakeLock, releaseWakeLock]);

    return (
        /*
         * Wrapper keeps the YouTube iframe accessible to iOS Safari.
         * MUST NOT use display:none or visibility:hidden — those block
         * media playback on iOS.  1×1px + opacity:0 is the safe pattern.
         */
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
    );
}
