import { useState, useEffect } from 'react';
import { useAppContext } from '@/lib/AppContext';
import styles from '@/styles/ImportForm.module.scss';

// ── Phase constants (local only — just for the POST in-flight state) ─────────
const IDLE = 'idle';
const PROCESSING = 'processing';  // POST in flight — extracting playlist

// Spotify playlist URL pattern — used for client-side validation
const SPOTIFY_PLAYLIST_RE = /^https:\/\/open\.spotify\.com\/playlist\/[A-Za-z0-9]+/;

// Spotify logo path
const SPOTIFY_PATH =
    'M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z';

export default function ImportForm({ onImportSuccess }) {
    const { activeImport, startTrackingImport, dismissImport } = useAppContext();
    const [url, setUrl] = useState('');
    const [urlError, setUrlError] = useState('');
    const [localPhase, setLocalPhase] = useState(IDLE); // only IDLE | PROCESSING
    const [error, setError] = useState('');

    // Notify parent when context reports the import is complete
    useEffect(() => {
        if (activeImport?.phase !== 'complete') return;
        const t = setTimeout(() => {
            onImportSuccess?.(activeImport);
        }, 1800);
        return () => clearTimeout(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeImport?.phase]);

    const handleUrlChange = (e) => {
        const v = e.target.value;
        setUrl(v);
        if (error) setError('');
        setUrlError(
            v && !SPOTIFY_PLAYLIST_RE.test(v)
                ? 'Enter a valid Spotify playlist URL (open.spotify.com/playlist/\u2026)'
                : ''
        );
    };

    const handleCancel = () => {
        if (localPhase === PROCESSING) {
            setLocalPhase(IDLE);
        } else {
            // Stop tracking in context (server continues matching in background)
            dismissImport();
        }
        setError('');
        setUrlError('');
        setUrl('');
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');

        if (!url.trim()) {
            setError('Please paste a Spotify playlist URL');
            return;
        }

        if (!SPOTIFY_PLAYLIST_RE.test(url.trim())) {
            setError('Enter a valid Spotify playlist URL (open.spotify.com/playlist/\u2026)');
            return;
        }

        setLocalPhase(PROCESSING);

        try {
            const res = await fetch('/api/import-playlist', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: url.trim() }),
            });

            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.error || 'Import failed');
            }

            const playlist = data.playlist;
            setUrl('');
            setLocalPhase(IDLE);
            // Hand off all progress tracking to AppContext so it survives navigation
            startTrackingImport(playlist);
        } catch (err) {
            setError(err.message);
            setLocalPhase(IDLE);
        }
    };

    // ── Phase: Processing ─────────────────────────────────────
    if (localPhase === PROCESSING) {
        return (
            <div className={styles.stateCard}>
                <div className={styles.processingRing} />
                <div className={styles.stateBody}>
                    <span className={styles.stateTitle}>Extracting playlist</span>
                    <span className={styles.stateDesc}>Connecting to Spotify…</span>
                </div>
                <button type="button" className={styles.cancelBtn} onClick={handleCancel}>
                    Cancel
                </button>
            </div>
        );
    }

    // ── Phase: Matching (driven by AppContext) ────────────────
    if (activeImport?.phase === 'matching') {
        return (
            <div className={styles.stateCard}>
                {activeImport.coverImage ? (
                    <img
                        src={activeImport.coverImage}
                        alt={activeImport.name}
                        className={styles.coverThumb}
                        width={52}
                        height={52}
                    />
                ) : (
                    <div className={styles.coverThumbPlaceholder} />
                )}
                <div className={styles.stateBody}>
                    <span className={styles.stateTitle}>
                        {activeImport.name || 'Matching tracks…'}
                    </span>
                    <span className={styles.stateDesc}>Finding YouTube sources…</span>
                    <div className={styles.progressTrack}>
                        <div
                            className={styles.progressFill}
                            style={{ width: `${activeImport.progress}%` }}
                        />
                    </div>
                    <span className={styles.progressLabel}>{activeImport.progress}% matched</span>
                </div>
                <button type="button" className={styles.cancelBtn} onClick={handleCancel}>
                    Cancel
                </button>
            </div>
        );
    }

    // ── Phase: Complete (driven by AppContext) ─────────────────
    if (activeImport?.phase === 'complete') {
        return (
            <div className={`${styles.stateCard} ${styles.completeCard}`}>
                <div className={styles.checkmark}>
                    <svg viewBox="0 0 52 52" fill="none" aria-hidden="true">
                        <circle
                            cx="26" cy="26" r="25"
                            stroke="currentColor"
                            strokeWidth="2"
                            className={styles.checkCircle}
                        />
                        <path
                            d="M14 26l9 9 15-17"
                            stroke="currentColor"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className={styles.checkPath}
                        />
                    </svg>
                </div>
                <div className={styles.stateBody}>
                    <span className={styles.stateTitle}>Playlist ready!</span>
                    <span className={styles.stateDesc}>{activeImport.name}</span>
                </div>
            </div>
        );
    }

    // ── Phase: Idle (default) ─────────────────────────────────
    return (
        <form className={styles.form} onSubmit={handleSubmit}>
            <div className={styles.inputGroup}>
                <div className={`${styles.inputWrapper}${urlError ? ` ${styles.inputWrapperInvalid}` : ''}`}>
                    <svg
                        className={styles.icon}
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        width="20"
                        height="20"
                        aria-hidden="true"
                    >
                        <path d={SPOTIFY_PATH} />
                    </svg>
                    <input
                        type="text"
                        className={styles.input}
                        value={url}
                        onChange={handleUrlChange}
                        placeholder="Paste Spotify playlist URL here…"
                    />
                </div>
                <button type="submit" className={styles.button}>
                    Import Playlist
                </button>
            </div>
            {(urlError || error) && (
                <p className={styles.error} role="alert">
                    {urlError || error}
                </p>
            )}
        </form>
    );
}
