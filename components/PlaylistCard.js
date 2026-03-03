import { useState } from 'react';
import styles from '@/styles/PlaylistCard.module.scss';

export default function PlaylistCard({ playlist, onClick }) {
    const [resuming, setResuming] = useState(false);

    const statusColors = {
        matching: '#3b82f6',
        ready: '#10b981',
        paused: '#f59e0b',
        error: '#ef4444',
    };

    const handleResume = async (e) => {
        e.stopPropagation(); // don't trigger card onClick
        setResuming(true);
        try {
            const res = await fetch('/api/youtube-match', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ playlistId: playlist.id }),
            });
            if (res.ok) {
                // Reload to pick up new 'matching' status via polling
                onClick?.(playlist);
            }
        } catch (err) {
            console.error('Failed to resume matching:', err);
        } finally {
            setResuming(false);
        }
    };

    return (
        <div className={styles.card} onClick={() => onClick?.(playlist)}>
            <div className={styles.imageWrapper}>
                {playlist.coverImage ? (
                    <img
                        src={playlist.coverImage}
                        alt={playlist.name}
                        className={styles.coverImage}
                    />
                ) : (
                    <div className={styles.placeholder}>
                        <svg viewBox="0 0 24 24" width="48" height="48" fill="currentColor">
                            <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
                        </svg>
                    </div>
                )}
                <div className={styles.overlay}>
                    <svg viewBox="0 0 24 24" width="40" height="40" fill="currentColor">
                        <path d="M8 5v14l11-7z" />
                    </svg>
                </div>
            </div>
            <div className={styles.info}>
                <h3 className={styles.name}>{playlist.name}</h3>
                <p className={styles.meta}>{playlist.trackCount} tracks</p>
                <span
                    className={styles.status}
                    style={{ color: statusColors[playlist.status] || '#888' }}
                >
                    {playlist.status === 'ready'
                        ? 'Ready to play'
                        : playlist.status === 'matching'
                            ? 'Finding tracks...'
                            : playlist.status === 'paused'
                                ? 'Paused'
                                : 'Error'}
                </span>
                {playlist.status === 'paused' && (
                    <button
                        className={styles.resumeBtn}
                        onClick={handleResume}
                        disabled={resuming}
                    >
                        {resuming ? 'Resuming...' : 'Resume'}
                    </button>
                )}
            </div>
        </div>
    );
}
