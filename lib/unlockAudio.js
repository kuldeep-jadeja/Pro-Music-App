/**
 * iOS Safari Audio Unlock
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
 *
 * Must be called AFTER the YT.Player instance is created (i.e. after
 * the onReady event fires).
 */

let unlocked = false;
let silentAudio = null;

// Base64-encoded minimal silent MP3 (~0.1s) — avoids a network request.
// This is the smallest valid MP3 frame that iOS accepts.
const SILENT_MP3 =
    'data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAABhgC7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7//////////////////////////////////////////////////////////////////8AAAAATGF2YzU4LjEzAAAAAAAAAAAAAAAAJAAAAAAAAAABhkVLqZYAAAAAAAAAAAAAAAAA//tQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAABhgC7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7//////////////////////////////////////////////////////////////////8AAAAATGF2YzU4LjEzAAAAAAAAAAAAAAAAJAAAAAAAAAABhkVLqZYAAAAAAAAAAAAAAAAA';

/**
 * Create and return the silent audio element (singleton).
 * Calling play() on this inside a user gesture keeps the audio session alive.
 */
function getSilentAudio() {
    if (silentAudio) return silentAudio;
    if (typeof document === 'undefined') return null;

    silentAudio = document.createElement('audio');
    silentAudio.src = SILENT_MP3;
    silentAudio.loop = true;
    silentAudio.volume = 0;
    silentAudio.setAttribute('playsinline', '');
    silentAudio.setAttribute('webkit-playsinline', '');
    return silentAudio;
}

/**
 * Register a one-time audio unlock listener on click / touchstart.
 * Safe to call multiple times — only the first call has any effect.
 *
 * @param {() => object} getPlayer  Returns the current YT.Player instance
 */
export function registerAudioUnlock(getPlayer) {
    if (unlocked || typeof document === 'undefined') return;

    const unlock = () => {
        if (unlocked) return;
        unlocked = true;

        const player = getPlayer();

        try {
            if (player && typeof player.playVideo === 'function') {
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
 * Resume the silent audio helper (call after user gesture-initiated playback).
 * This is a no-op if the silent audio hasn't been created yet.
 */
export function resumeSilentAudio() {
    try {
        const sa = getSilentAudio();
        if (sa && sa.paused) {
            const p = sa.play();
            if (p && typeof p.catch === 'function') p.catch(() => { });
        }
    } catch { }
}

/**
 * Check whether the audio context has been unlocked.
 */
export function isAudioUnlocked() {
    return unlocked;
}
