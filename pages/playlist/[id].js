import Head from 'next/head';
import { useEffect } from 'react';
import { useRouter } from 'next/router';
import TrackList from '@/components/TrackList';
import { useAppContext } from '@/lib/AppContext';
import styles from '@/styles/Playlist.module.scss';

export default function PlaylistPage() {
    const router = useRouter();
    const { id } = router.query;

    const {
        authChecked,
        user,
        activePlaylist,
        loadingTracks,
        loadPlaylist,
        tracks,
        currentTrack,
        handleTrackSelect,
    } = useAppContext();

    // Playable tracks (have a YouTube match)
    const playableTracks = tracks?.filter((t) => t.youtubeVideoId) ?? [];

    const handlePlayAll = () => {
        if (!playableTracks.length) return;
        const first = playableTracks[0];
        handleTrackSelect(first, tracks.indexOf(first));
    };

    const handleShuffle = () => {
        if (!playableTracks.length) return;
        const pick = playableTracks[Math.floor(Math.random() * playableTracks.length)];
        handleTrackSelect(pick, tracks.indexOf(pick));
    };

    // Redirect unauthenticated visitors to login
    useEffect(() => {
        if (authChecked && !user) {
            router.replace('/login');
        }
    }, [authChecked, user, router]);

    // Fetch playlist data whenever the route id changes
    useEffect(() => {
        if (id) loadPlaylist(id);
    }, [id, loadPlaylist]);

    // Wait for auth check before rendering
    if (!authChecked || !user) return null;

    const matchedCount =
        !loadingTracks && tracks?.length > 0
            ? tracks.filter((t) => t.youtubeVideoId).length
            : 0;

    const matchPct =
        tracks?.length > 0
            ? Math.round((matchedCount / tracks.length) * 100)
            : 0;

    // Show spinner until the correct playlist is loaded
    if (!activePlaylist || String(activePlaylist.id) !== String(id)) {
        return (
            <div className={styles.loading}>
                <span className={styles.spinner} />
                <p>Loading playlist…</p>
            </div>
        );
    }

    return (
        <>
            <Head>
                <title>{activePlaylist.name} — Demus</title>
                <meta name="description" content={`${activePlaylist.name} by ${activePlaylist.owner}`} />
            </Head>

            {/* ── Playlist header ─────────────────────────────── */}
            <div className={styles.header}>
                {activePlaylist.coverImage && (
                    <div
                        className={styles.headerBg}
                        style={{ backgroundImage: `url(${activePlaylist.coverImage})` }}
                        aria-hidden="true"
                    />
                )}
                <div className={styles.headerBgOverlay} aria-hidden="true" />

                <div className={styles.headerContent}>
                    {/* Cover art */}
                    <div className={styles.artWrap}>
                        {activePlaylist.coverImage ? (
                            <img
                                src={activePlaylist.coverImage}
                                alt={activePlaylist.name}
                                className={styles.cover}
                            />
                        ) : (
                            <div className={styles.artPlaceholder}>
                                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                                    <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
                                </svg>
                            </div>
                        )}
                    </div>

                    {/* Text meta */}
                    <div className={styles.meta}>
                        <span className={styles.label}>Playlist</span>
                        <h1 className={styles.name}>{activePlaylist.name}</h1>
                        <p className={styles.desc}>
                            {activePlaylist.owner}&nbsp;&middot;&nbsp;{activePlaylist.trackCount} tracks
                        </p>

                        {/* Play / Shuffle actions */}
                        {!loadingTracks && playableTracks.length > 0 && (
                            <div className={styles.actions}>
                                <button className={styles.playAllBtn} onClick={handlePlayAll}>
                                    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
                                        <path d="M8 5v14l11-7z" />
                                    </svg>
                                    Play
                                </button>
                                <button className={styles.shuffleBtn} onClick={handleShuffle}>
                                    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
                                        <path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z" />
                                    </svg>
                                    Shuffle
                                </button>
                            </div>
                        )}

                        {/* YouTube match progress */}
                        {!loadingTracks && tracks?.length > 0 && (
                            <div className={styles.matchProgress}>
                                <div className={styles.progressBar}>
                                    <div
                                        className={styles.progressFill}
                                        style={{ width: `${matchPct}%` }}
                                    />
                                </div>
                                <span className={styles.progressLabel}>
                                    {matchedCount}&thinsp;/&thinsp;{tracks.length} matched
                                </span>
                            </div>
                        )}

                        {/* Import status pill */}
                        {activePlaylist.status !== 'ready' && (
                            <span
                                className={`${styles.statusPill} ${styles[`status_${activePlaylist.status}`] ?? ''}`}
                            >
                                {activePlaylist.status === 'matching'
                                    ? 'Finding YouTube matches…'
                                    : activePlaylist.status === 'paused'
                                        ? 'Paused — rate limited'
                                        : activePlaylist.status === 'error'
                                            ? 'Error'
                                            : activePlaylist.status}
                            </span>
                        )}
                    </div>
                </div>
            </div>

            {/* ── Track list ──────────────────────────────────── */}
            {loadingTracks ? (
                <div className={styles.loading}>
                    <span className={styles.spinner} />
                    <p>Loading tracks…</p>
                </div>
            ) : (
                <TrackList
                    tracks={tracks}
                    currentTrackId={currentTrack?.id}
                    onTrackSelect={handleTrackSelect}
                    playlistStatus={activePlaylist.status}
                />
            )}
        </>
    );
}
