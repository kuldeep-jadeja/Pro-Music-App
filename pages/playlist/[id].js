import Head from 'next/head';
import { useEffect } from 'react';
import { useRouter } from 'next/router';
import TrackList from '@/components/TrackList';
import PlaylistHeader from '@/components/PlaylistHeader';
import Spinner from '@/components/Spinner';
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

    // Show spinner until the correct playlist is loaded
    if (!activePlaylist || String(activePlaylist.id) !== String(id)) {
        return (
            <div className={styles.loading}>
                <Spinner />
                <p>Loading playlist…</p>
            </div>
        );
    }

    return (
        <>
            <Head>
                <title>{activePlaylist.name} — Demus</title>
                <meta name="description" content={`${activePlaylist.name} by ${activePlaylist.owner}`} />
                <meta name="viewport" content="width=device-width, initial-scale=1" />
            </Head>

            {/* ── Playlist header ─────────────────────────────── */}
            <PlaylistHeader
                playlist={activePlaylist}
                tracks={tracks}
                loadingTracks={loadingTracks}
                onPlayAll={handlePlayAll}
                onShuffle={handleShuffle}
            />

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
