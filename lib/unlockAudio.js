/**
 * iOS Safari Audio Unlock + Background Keep-Alive
 *
 * iOS Safari blocks ALL programmatic audio/video playback until a genuine
 * user gesture (tap / click) has initiated media playback at least once.
 * This is a WebKit-level restriction that cannot be bypassed with
 * HTMLMediaElement tricks — the YouTube IFrame API is subject to the same
 * policy.
 *
 * Strategy:
 *   1. On the very first user interaction (click or touchstart), call
 *      player.playVideo() followed immediately by player.pauseVideo().
 *      This "unlocks" the media session so that subsequent programmatic
 *      loadVideoById / playVideo calls work without a gesture.
 *   2. Create a silent <audio> element that loops a tiny silent clip.
 *      This keeps the iOS audio session alive when the app is in the
 *      background, preventing the OS from suspending the WebKit process
 *      and killing YouTube iframe playback.
 *   3. Create a Web Audio API AudioContext with a silent oscillator.
 *      This provides a secondary, more resilient keep-alive signal that
 *      iOS/Android are less likely to suspend than an <audio> element.
 *
 * Must be called AFTER the YT.Player instance is created (i.e. after
 * the onReady event fires).
 */

let unlocked = false;
let silentAudio = null;
let audioCtx = null;

// Dev-only: reset singleton state on HMR so unlock listeners re-register cleanly
if (process.env.NODE_ENV === 'development' && typeof module !== 'undefined' && module.hot) {
    module.hot.dispose(() => {
        unlocked = false;
        silentAudio = null;
        audioCtx = null;
    });
}

// Base64-encoded minimal silent MP3 (~0.1s) — avoids a network request.
// This is the smallest valid MP3 frame that iOS accepts.
export const SILENT_MP3 =
    'data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAABhgC7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7//////////////////////////////////////////////////////////////////8AAAAATGF2YzU4LjEzAAAAAAAAAAAAAAAAJAAAAAAAAAABhkVLqZYAAAAAAAAAAAAAAAAA//tQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAABhgC7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7//////////////////////////////////////////////////////////////////8AAAAATGF2YzU4LjEzAAAAAAAAAAAAAAAAJAAAAAAAAAABhkVLqZYAAAAAAAAAAAAAAAAA';

/**
 * Create and return the silent audio element (singleton).
 * Calling play() on this inside a user gesture keeps the audio session alive.
 */
function getSilentAudio() {
    if (silentAudio) return silentAudio;
    if (typeof document === 'undefined') return null;

    silentAudio = document.createElement('audio');
    silentAudio.setAttribute('id', 'silent-audio-keepalive');
    silentAudio.src = SILENT_MP3;
    silentAudio.loop = true;
    silentAudio.volume = 0.001;
    silentAudio.setAttribute('playsinline', '');
    silentAudio.setAttribute('webkit-playsinline', '');

    // Some versions of iOS Safari require the element to be in the DOM
    // to keep the audio session active in the background.
    silentAudio.style.position = 'fixed';
    silentAudio.style.top = '0';
    silentAudio.style.left = '0';
    silentAudio.style.width = '1px';
    silentAudio.style.height = '1px';
    silentAudio.style.opacity = '0.01';
    silentAudio.style.pointerEvents = 'none';

    if (typeof document !== 'undefined' && document.body) {
        document.body.appendChild(silentAudio);
    }

    return silentAudio;
}

/**
 * Create and return the Web Audio API AudioContext (singleton).
 * A silent oscillator connected through a zero-gain node keeps the audio
 * session alive more reliably than an <audio> element on iOS 15+.
 */
function getAudioContext() {
    if (audioCtx) return audioCtx;
    if (typeof window === 'undefined') return null;

    try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;

        audioCtx = new AC();

        // Create a silent oscillator → gain(0.001) → destination.
        // This runs continuously and is nearly impossible for the OS to
        // distinguish from "real" audio, keeping the session alive.
        const oscillator = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        gainNode.gain.value = 0.001; // tiny volume instead of 0
        oscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        oscillator.start(0);

        // Keep-alive: periodically adjust gain slightly to prevent the OS
        // from thinking the context is idle.
        setInterval(() => {
            if (audioCtx.state === 'running') {
                const val = gainNode.gain.value;
                gainNode.gain.setValueAtTime(val === 0.001 ? 0.0011 : 0.001, audioCtx.currentTime);
            }
        }, 30000);
    } catch {
        // AudioContext not available — fall back to <audio> only
    }

    return audioCtx;
}

/**
 * Resume the AudioContext if it was suspended by the OS.
 * Must be called inside a user gesture on iOS, or after visibility returns.
 */
export function resumeAudioContext() {
    try {
        const ctx = getAudioContext();
        if (ctx && ctx.state === 'suspended') {
            ctx.resume().catch(() => { });
        }
    } catch { }
}

/**
 * Register a one-time audio unlock listener on click / touchstart.
 * Safe to call multiple times — only the first call has any effect.
 *
 * @param {() => object} getPlayer      Returns the current YT.Player instance
 * @param {() => string} [getActivePlayer]  Returns 'audio' | 'youtube' — skip
 *        the IFrame unlock tap when HTML5 audio is the active player.
 * @param {() => HTMLAudioElement} [getAudioElement] Returns the main <audio> element
 */
export function registerAudioUnlock(getPlayer, getActivePlayer, getAudioElement) {
    if (unlocked || typeof document === 'undefined') return;

    const unlock = () => {
        if (unlocked) return;
        unlocked = true;

        const player = getPlayer();
        const audioEl = typeof getAudioElement === 'function' ? getAudioElement() : null;

        try {
            // Prime the main audio element for subsequent programmatic playback.
            // ONLY if it's not currently being loaded by a fresh `playTrack` call.
            // If it IS being loaded, `playTrack` already started it. Calling play/pause here
            // will interrupt the real playback intent resulting in the "double-click" bug.
            if (audioEl && audioEl.paused && !audioEl._isTrackLoading) {
                // If the audio element has no real source yet, give it one
                if (!audioEl.src || audioEl.src.includes('data:')) {
                    audioEl.src = SILENT_MP3;
                }
                audioEl.play().catch(() => {});
            }

            // Only unlock-tap the IFrame when it is the active player.
            // If HTML5 audio is streaming, skip the spurious play/pause
            // to avoid interrupting the audio session.
            const isYouTubeActive = !getActivePlayer || getActivePlayer() !== 'audio';
            if (player && typeof player.playVideo === 'function' && isYouTubeActive) {
                player.playVideo();
                // Pause SYNCHRONOUSLY (no setTimeout) so both postMessages
                // are queued before the play-button's click handler runs.
                player.pauseVideo();
            }
        } catch { }

        // Start the silent audio loop inside this user gesture.
        // This keeps the iOS audio session alive in the background.
        try {
            const sa = getSilentAudio();
            if (sa) {
                const p = sa.play();
                if (p && typeof p.catch === 'function') p.catch(() => { });
            }
        } catch { }

        // Initialise and resume the AudioContext inside the user gesture.
        // iOS requires AudioContext.resume() to be triggered by a gesture.
        try {
            const ctx = getAudioContext();
            if (ctx && ctx.state === 'suspended') {
                ctx.resume().catch(() => { });
            }
        } catch { }

        document.removeEventListener('click', unlock);
        document.removeEventListener('touchstart', unlock);
    };

    // Do NOT use { once: true } combined with removeEventListener —
    // the manual remove inside the handler is sufficient and avoids
    // a double-remove race on iOS Safari.
    document.addEventListener('click', unlock);
    document.addEventListener('touchstart', unlock);
}

/**
 * Resume the silent audio helper AND AudioContext.
 * Call after user gesture-initiated playback or on visibility return.
 */
export function resumeSilentAudio() {
    try {
        const sa = getSilentAudio();
        if (sa && sa.paused) {
            const p = sa.play();
            if (p && typeof p.catch === 'function') p.catch(() => { });
        }
    } catch { }

    // Also resume AudioContext — it may have been suspended while backgrounded
    resumeAudioContext();
}

/**
 * Check whether the audio context has been unlocked.
 */
export function isAudioUnlocked() {
    return unlocked;
}
