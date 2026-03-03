import { useState } from 'react';
import styles from '@/styles/ImportForm.module.scss';

export default function ImportForm({ onImportSuccess }) {
    const [url, setUrl] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');

        if (!url.trim()) {
            setError('Please paste a Spotify playlist URL');
            return;
        }

        setLoading(true);

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

            setUrl('');
            onImportSuccess?.(data.playlist);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <form className={styles.form} onSubmit={handleSubmit}>
            <div className={styles.inputGroup}>
                <div className={styles.inputWrapper}>
                    <svg
                        className={styles.icon}
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        width="20"
                        height="20"
                    >
                        <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
                    </svg>
                    <input
                        type="text"
                        className={styles.input}
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                        placeholder="Paste Spotify playlist URL here..."
                        disabled={loading}
                    />
                </div>
                <button
                    type="submit"
                    className={styles.button}
                    disabled={loading}
                >
                    {loading ? (
                        <span className={styles.spinner} />
                    ) : (
                        'Import Playlist'
                    )}
                </button>
            </div>
            {error && <p className={styles.error}>{error}</p>}
        </form>
    );
}
