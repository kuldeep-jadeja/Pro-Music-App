import PlaylistCard from '@/components/PlaylistCard';
import styles from '@/styles/PlaylistGrid.module.scss';

export default function PlaylistGrid({
    playlists = [],
    onPlaylistClick,
    title,
    emptyText = 'No playlists yet',
    id,
}) {
    return (
        <section id={id} className={styles.section}>
            {title && <h2 className={styles.title}>{title}</h2>}
            {playlists.length === 0 ? (
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
