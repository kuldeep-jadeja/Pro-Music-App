import { useEffect, useRef } from 'react';
import { usePlayer } from '@/context/PlayerContext';

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
    const { initPlayer } = usePlayer();
    const scriptLoaded = useRef(false);

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
