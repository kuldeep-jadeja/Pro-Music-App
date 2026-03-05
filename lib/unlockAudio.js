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
 *   On the very first user interaction (click or touchstart), call
 *   player.playVideo() followed immediately by player.pauseVideo().
 *   This "unlocks" the media session so that subsequent programmatic
 *   loadVideoById / playVideo calls work without a gesture.
 *
 * Must be called AFTER the YT.Player instance is created (i.e. after
 * the onReady event fires).
 */

let unlocked = false;

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
                // The old 100 ms delay fired AFTER the user's intentional
                // togglePlay, silently pausing the song they just started —
                // that was the root cause of the "tap twice to play" bug on iOS.
                player.pauseVideo();
            }
        } catch { }

        document.removeEventListener('click', unlock);
        document.removeEventListener('touchstart', unlock);
    };

    document.addEventListener('click', unlock, { once: true });
    document.addEventListener('touchstart', unlock, { once: true });
}

/**
 * Check whether the audio context has been unlocked.
 */
export function isAudioUnlocked() {
    return unlocked;
}
