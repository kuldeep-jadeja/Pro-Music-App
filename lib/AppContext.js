import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/router';

const AppContext = createContext(null);

export function AppProvider({ children }) {
    const router = useRouter();

    // ── Auth ────────────────────────────────────────────────
    const [user, setUser] = useState(null);
    const [authChecked, setAuthChecked] = useState(false);

    useEffect(() => {
        (async () => {
            try {
                const res = await fetch('/api/auth/me');
                if (res.ok) {
                    const data = await res.json();
                    setUser(data.user);
                }
            } catch {
                // not authenticated
            } finally {
                setAuthChecked(true);
            }
        })();
    }, []);

    const handleLogout = useCallback(async () => {
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
    }, [router]);

    // ── Playlists ───────────────────────────────────────────
    const [playlists, setPlaylists] = useState([]);
    const [loadingPlaylists, setLoadingPlaylists] = useState(false);

    useEffect(() => {
        if (!user) return;
        setLoadingPlaylists(true);
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
            } finally {
                setLoadingPlaylists(false);
            }
        })();
    }, [user]);

    // ── Active playlist + tracks ────────────────────────────
    const [activePlaylist, setActivePlaylist] = useState(null);
    const [tracks, setTracks] = useState([]);
    const [loadingTracks, setLoadingTracks] = useState(false);

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

    const handleImportSuccess = useCallback((playlist) => {
        setPlaylists((prev) => {
            const exists = prev.find((p) => p.id === playlist.id);
            if (exists) return prev.map((p) => (p.id === playlist.id ? playlist : p));
            return [playlist, ...prev];
        });
        loadPlaylist(playlist.id);
    }, [loadPlaylist]);

    const clearActivePlaylist = useCallback(() => {
        setActivePlaylist(null);
        setTracks([]);
    }, []);

    // Polling for in-progress playlists
    useEffect(() => {
        if (
            !activePlaylist ||
            activePlaylist.status === 'ready' ||
            activePlaylist.status === 'paused' ||
            activePlaylist.status === 'error'
        ) return;

        const pollInterval = setInterval(async () => {
            try {
                const res = await fetch(`/api/playlist/${activePlaylist.id}/status`);
                const data = await res.json();
                if (!res.ok) return;

                setActivePlaylist((prev) =>
                    prev ? { ...prev, status: data.status, importProgress: data.importProgress } : prev
                );

                if (data.status === 'ready' || data.status === 'paused' || data.status === 'error') {
                    clearInterval(pollInterval);
                    setPlaylists((prev) =>
                        prev.map((p) =>
                            p.id === activePlaylist.id ? { ...p, status: data.status } : p
                        )
                    );
                    if (data.status === 'ready') loadPlaylist(activePlaylist.id);
                }
            } catch {
                /* ignore */
            }
        }, 3000);

        return () => clearInterval(pollInterval);
    }, [activePlaylist?.id, activePlaylist?.status, loadPlaylist]);

    // ── Player ──────────────────────────────────────────────
    const [currentTrack, setCurrentTrack] = useState(null);
    const [currentIndex, setCurrentIndex] = useState(-1);

    const handleTrackSelect = useCallback((track, index) => {
        setCurrentTrack(track);
        setCurrentIndex(index);
    }, []);

    const handleTrackChange = useCallback((track, index) => {
        setCurrentTrack(track);
        setCurrentIndex(index);
    }, []);

    return (
        <AppContext.Provider value={{
            // auth
            user,
            setUser,
            authChecked,
            handleLogout,
            // playlists
            playlists,
            setPlaylists,
            loadingPlaylists,
            activePlaylist,
            loadingTracks,
            loadPlaylist,
            handleImportSuccess,
            clearActivePlaylist,
            // tracks / player
            tracks,
            currentTrack,
            currentIndex,
            handleTrackSelect,
            handleTrackChange,
        }}>
            {children}
        </AppContext.Provider>
    );
}

export function useAppContext() {
    const ctx = useContext(AppContext);
    if (!ctx) throw new Error('useAppContext must be used inside AppProvider');
    return ctx;
}
