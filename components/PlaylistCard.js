import { useState } from 'react';
import styles from '@/styles/PlaylistCard.module.scss';

const STATUS_LABELS = {
    matching: 'Matching…',
    paused: 'Paused',
    error: 'Error',
    ready: 'Ready',
};

export default function PlaylistCard({ playlist, onClick }) {
    const [resuming, setResuming] = useState(false);

    const handleResume = async (e) => {
        e.stopPropagation();
        setResuming(true);
        try {
            const res = await fetch('/api/youtube-match', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ playlistId: playlist.id }),
            });
            if (res.ok) {
                onClick?.(playlist);
            }
        } catch (err) {
            console.error('Failed to resume matching:', err);
        } finally {
            setResuming(false);
        }
    };

    const badgeClass = playlist.status
        ? `${styles.badge} ${styles[`badge_${playlist.status}`] ?? ''}`
        : styles.badge;

    const matchPct = playlist.importProgress ?? 0;

    return (
        <div className={styles.card} onClick={() => onClick?.(playlist)}>
            <div className={styles.artWrap}>
                {playlist.coverImage ? (
                    <img
                        src={playlist.coverImage}
                        alt={playlist.name}
                        className={styles.cover}
                    />
                ) : (
                    <div className={styles.placeholder}>
                        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                            <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
                        </svg>
                    </div>
                )}
                {/* Match progress strip — visible while matching */}
                {playlist.status === 'matching' && (
                    <div className={styles.matchProgressTrack}>
                        <div
                            className={styles.matchProgressFill}
                            style={{ width: `${matchPct}%` }}
                        />
                    </div>
                )}
                <div className={styles.playOverlay} aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="currentColor">
                        <path d="M8 5v14l11-7z" />
                    </svg>
                </div>
            </div>
            <div className={styles.info}>
                <p className={styles.name}>{playlist.name}</p>
                <p className={styles.meta}>{playlist.trackCount} tracks</p>
                <div className={styles.footer}>
                    {playlist.status && playlist.status !== 'ready' && (
                        <span className={badgeClass}>
                            {playlist.status === 'matching' && (
                                <span className={styles.matchingDot} aria-hidden="true" />
                            )}
                            {STATUS_LABELS[playlist.status] ?? playlist.status}
                        </span>
                    )}
                    {playlist.status === 'paused' && (
                        <button
                            className={styles.resumeBtn}
                            onClick={handleResume}
                            disabled={resuming}
                        >
                            {resuming ? 'Resuming…' : 'Resume'}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
