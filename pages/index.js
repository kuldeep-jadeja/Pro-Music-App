import Head from 'next/head';
import Link from 'next/link';
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import Navbar from '@/components/Navbar';
import ImportForm from '@/components/ImportForm';
import PlaylistCard from '@/components/PlaylistCard';
import TrackList from '@/components/TrackList';
import Player from '@/components/Player';
import styles from '@/styles/Home.module.scss';

export default function Home() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [playlists, setPlaylists] = useState([]);
  const [activePlaylist, setActivePlaylist] = useState(null);
  const [tracks, setTracks] = useState([]);
  const [currentTrack, setCurrentTrack] = useState(null);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [loadingTracks, setLoadingTracks] = useState(false);

  // Check auth status on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/auth/me');
        if (res.ok) {
          const data = await res.json();
          setUser(data.user);
        }
      } catch {
        // Not authenticated — that's fine
      } finally {
        setAuthChecked(true);
      }
    })();
  }, []);

  // Fetch user's playlists when authenticated
  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const res = await fetch('/api/playlists');
        if (res.ok) {
          const data = await res.json();
          setPlaylists(
            (data.playlists || []).map((p) => ({
              id: p._id,
              name: p.name,
              status: p.status,
              importProgress: p.importProgress,
              coverImage: p.coverImage,
            }))
          );
        }
      } catch (err) {
        console.error('Failed to fetch playlists:', err);
      }
    })();
  }, [user]);

  // Logout handler
  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    setUser(null);
    setPlaylists([]);
    setActivePlaylist(null);
    setTracks([]);
    setCurrentTrack(null);
    setCurrentIndex(-1);
    router.push('/login');
  };

  // Load full playlist with tracks
  // Declared first — handleImportSuccess depends on this in its useCallback
  // dependency array, so it must be initialized before that hook runs to
  // avoid a const Temporal Dead Zone (TDZ) ReferenceError at prerender time.
  const loadPlaylist = useCallback(async (playlistId) => {
    setLoadingTracks(true);
    try {
      const res = await fetch(`/api/playlist/${playlistId}`);
      const data = await res.json();

      if (res.ok) {
        setActivePlaylist(data);
        setTracks(data.tracks || []);
      }
    } catch (err) {
      console.error('Failed to load playlist:', err);
    } finally {
      setLoadingTracks(false);
    }
  }, []);

  // Handle successful import
  const handleImportSuccess = useCallback((playlist) => {
    setPlaylists((prev) => {
      const exists = prev.find((p) => p.id === playlist.id);
      if (exists) {
        return prev.map((p) => (p.id === playlist.id ? playlist : p));
      }
      return [playlist, ...prev];
    });

    // Auto-load the imported playlist
    loadPlaylist(playlist.id);
  }, [loadPlaylist]);

  // Poll for playlist status updates (matching -> ready/paused/error)
  // Uses the lightweight /api/playlist/[id]/status endpoint that returns
  // only { status, importProgress } — no .populate('tracks'), no full
  // track serialization.  The full playlist (with tracks) is fetched ONCE
  // when status transitions to 'ready'.
  useEffect(() => {
    if (
      !activePlaylist ||
      activePlaylist.status === 'ready' ||
      activePlaylist.status === 'paused' ||
      activePlaylist.status === 'error'
    ) {
      return;
    }

    const pollInterval = setInterval(async () => {
      try {
        // Lightweight status-only fetch — 2 fields, no populate
        const res = await fetch(`/api/playlist/${activePlaylist.id}/status`);
        const data = await res.json();

        if (!res.ok) return;

        // Update progress in the active playlist view
        setActivePlaylist((prev) =>
          prev ? { ...prev, status: data.status, importProgress: data.importProgress } : prev
        );

        // Terminal state reached — fetch full playlist with tracks once
        if (data.status === 'ready' || data.status === 'paused' || data.status === 'error') {
          clearInterval(pollInterval);

          // Update sidebar card status
          setPlaylists((prev) =>
            prev.map((p) =>
              p.id === activePlaylist.id
                ? { ...p, status: data.status }
                : p
            )
          );

          // Fetch the full playlist (with tracks) now that matching is done
          if (data.status === 'ready') {
            loadPlaylist(activePlaylist.id);
          }
        }
      } catch {
        /* ignore polling errors */
      }
    }, 3000);

    return () => clearInterval(pollInterval);
  }, [activePlaylist?.id, activePlaylist?.status]);

  // Track selection
  const handleTrackSelect = (track, index) => {
    setCurrentTrack(track);
    setCurrentIndex(index);
  };

  const handleTrackChange = (track, index) => {
    setCurrentTrack(track);
    setCurrentIndex(index);
  };

  return (
    <>
      <Head>
        <title>Demus - Your Music, Your Way</title>
        <meta name="description" content="Import Spotify playlists and stream for free" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <div className={styles.app}>
        <Navbar user={user} onLogout={handleLogout} />

        <main className={styles.main}>
          {/* Sidebar */}
          <aside className={styles.sidebar}>
            <h2 className={styles.sidebarTitle}>Your Library</h2>
            {!user ? (
              <p className={styles.sidebarEmpty}>
                <Link href="/login">Log in</Link> to see your playlists
              </p>
            ) : playlists.length === 0 ? (
              <p className={styles.sidebarEmpty}>
                Import a Spotify playlist to get started
              </p>
            ) : (
              <div className={styles.playlistGrid}>
                {playlists.map((pl) => (
                  <PlaylistCard
                    key={pl.id}
                    playlist={pl}
                    onClick={() => loadPlaylist(pl.id)}
                  />
                ))}
              </div>
            )}
          </aside>

          {/* Content */}
          <section className={styles.content}>
            {user ? (
              <ImportForm onImportSuccess={handleImportSuccess} />
            ) : (
              <div className={styles.loginCta}>
                <h2>Welcome to Demus</h2>
                <p>Import Spotify playlists and stream for free.</p>
                <Link href="/login" className={styles.ctaBtn}>Log in to get started</Link>
              </div>
            )}

            {activePlaylist && (
              <div className={styles.playlistHeader}>
                {activePlaylist.coverImage && (
                  <img
                    src={activePlaylist.coverImage}
                    alt={activePlaylist.name}
                    className={styles.playlistCover}
                  />
                )}
                <div className={styles.playlistMeta}>
                  <span className={styles.playlistLabel}>PLAYLIST</span>
                  <h1 className={styles.playlistName}>{activePlaylist.name}</h1>
                  <p className={styles.playlistDesc}>
                    {activePlaylist.owner} &middot; {activePlaylist.trackCount} tracks
                    {activePlaylist.status !== 'ready' && (
                      <span className={styles.statusBadge}>
                        {activePlaylist.status === 'matching'
                          ? ' — Finding YouTube matches...'
                          : activePlaylist.status === 'paused'
                            ? ' — Paused (rate limited)'
                            : activePlaylist.status === 'error'
                              ? ' — Error'
                              : ''}
                      </span>
                    )}
                  </p>
                </div>
              </div>
            )}

            {loadingTracks ? (
              <div className={styles.loading}>
                <span className={styles.spinner} />
                <p>Loading tracks...</p>
              </div>
            ) : (
              <TrackList
                tracks={tracks}
                currentTrackId={currentTrack?.id}
                onTrackSelect={handleTrackSelect}
              />
            )}
          </section>
        </main>

        {/* Player Bar */}
        <Player
          track={currentTrack}
          playlist={tracks}
          currentIndex={currentIndex}
          onTrackChange={handleTrackChange}
        />
      </div>
    </>
  );
}
