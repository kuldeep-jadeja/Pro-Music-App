import PlaylistCard from '@/components/PlaylistCard';
import styles from '@/styles/PlaylistGrid.module.scss';

const SKELETON_COUNT = 6;

function SkeletonCard() {
    return <div className={styles.skeletonCard} aria-hidden="true" />;
}

export default function PlaylistGrid({
    playlists = [],
    onPlaylistClick,
    title,
    emptyText = 'No playlists yet',
    id,
    loading = false,
}) {
    return (
        <section id={id} className={styles.section}>
            {title && <h2 className={styles.title}>{title}</h2>}
            {loading ? (
                <div className={styles.grid} aria-busy="true" aria-label="Loading playlists">
                    {Array.from({ length: SKELETON_COUNT }).map((_, i) => (
                        <SkeletonCard key={i} />
                    ))}
                </div>
            ) : playlists.length === 0 ? (
                <p className={styles.empty}>{emptyText}</p>
            ) : (
                <div className={styles.grid}>
                    {playlists.map((pl) => (
                        <PlaylistCard
                            key={pl.id}
                            playlist={pl}
                            onClick={onPlaylistClick}
                        />
                    ))}
                </div>
            )}
        </section>
    );
}
