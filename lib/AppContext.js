import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/router';
import { usePlayer } from '@/context/PlayerContext';

const AppContext = createContext(null);

export function AppProvider({ children }) {
    const router = useRouter();
    const { playTrack, setQueue } = usePlayer();

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

    useEffect(() => {
        setQueue(tracks || []);
    }, [tracks, setQueue]);

    // ── Active import tracking (persists across navigation) ─
    // Shape: { id, name, coverImage, phase: 'matching'|'complete'|'error', progress: 0-100 }
    const [activeImport, setActiveImport] = useState(null);

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
        setActiveImport(null);
        setPlaylists((prev) => {
            const exists = prev.find((p) => p.id === playlist.id);
            if (exists) return prev.map((p) =>
                p.id === playlist.id ? { ...p, status: 'ready', importProgress: 100 } : p
            );
            return [{
                id: playlist.id,
                name: playlist.name,
                status: 'ready',
                importProgress: 100,
                coverImage: playlist.coverImage,
            }, ...prev];
        });
        loadPlaylist(playlist.id);
    }, [loadPlaylist]);

    const clearActivePlaylist = useCallback(() => {
        setActivePlaylist(null);
        setTracks([]);
    }, []);

    // Register a new import in context; all polling happens here so it
    // survives page navigation and playing other songs.
    const startTrackingImport = useCallback((playlist) => {
        setActiveImport({
            id: playlist.id,
            name: playlist.name || '',
            coverImage: playlist.coverImage || '',
            phase: playlist.status === 'ready' ? 'complete' : 'matching',
            progress: playlist.status === 'ready' ? 100 : (playlist.importProgress || 0),
        });
        setPlaylists((prev) => {
            const exists = prev.find((p) => p.id === playlist.id);
            if (exists) return prev.map((p) =>
                p.id === playlist.id
                    ? { ...p, status: playlist.status, importProgress: playlist.importProgress || 0 }
                    : p
            );
            return [{
                id: playlist.id,
                name: playlist.name,
                status: playlist.status,
                importProgress: playlist.importProgress || 0,
                coverImage: playlist.coverImage,
            }, ...prev];
        });
    }, []);

    const dismissImport = useCallback(() => setActiveImport(null), []);

    // Poll active import progress — lives in context so it survives
    // page navigation and playing other songs.
    useEffect(() => {
        if (!activeImport || activeImport.phase !== 'matching') return;

        const pollId = setInterval(async () => {
            try {
                const res = await fetch(`/api/playlist/${activeImport.id}/status`);
                if (!res.ok) return;
                const data = await res.json();

                const newProgress = data.importProgress ?? 0;
                const isDone = data.status === 'ready';
                const isError = data.status === 'paused' || data.status === 'error';

                setActiveImport((prev) =>
                    prev ? {
                        ...prev,
                        progress: newProgress,
                        phase: isDone ? 'complete' : isError ? 'error' : 'matching',
                    } : null
                );

                // Keep every PlaylistCard's progress bar in sync
                setPlaylists((prev) =>
                    prev.map((p) =>
                        p.id === activeImport.id
                            ? { ...p, status: data.status, importProgress: newProgress }
                            : p
                    )
                );

                if (isDone) {
                    clearInterval(pollId);
                    loadPlaylist(activeImport.id);
                } else if (isError) {
                    clearInterval(pollId);
                }
            } catch {
                // Network hiccup — keep polling
            }
        }, 1500);

        return () => clearInterval(pollId);
    }, [activeImport?.id, activeImport?.phase, loadPlaylist]);

    // ── Admin surface: runtime recheck loop ────────────────
    // While on /admin or any /admin/* route, periodically re-verify admin
    // access server-side. On the first 403, redirect immediately without
    // waiting for the next interval tick.
    //
    // Cadence: every 5 minutes (300 000 ms).
    // Source of truth: /api/admin/access-check (requireAdmin-wrapped).
    // First 403 → redirect to /?adminAccess=required and clear interval.
    useEffect(() => {
        const isAdminRoute =
            router.pathname === '/admin' ||
            router.pathname.startsWith('/admin/');

        if (!isAdminRoute || !user) return;

        const checkAdminAccess = async () => {
            try {
                const res = await fetch('/api/admin/access-check');
                if (res.status === 403 || res.status === 401) {
                    // Admin rights lost or session expired — redirect immediately
                    router.replace('/?adminAccess=required');
                } else if (res.ok) {
                    // Keep user state in sync if isAdmin changed server-side
                    const meRes = await fetch('/api/auth/me');
                    if (meRes.ok) {
                        const data = await meRes.json();
                        setUser(data.user);
                    }
                }
            } catch {
                // Network error — do not redirect; will retry on next interval
            }
        };

        // Immediate first check, then on 5-minute interval
        checkAdminAccess();
        const intervalId = setInterval(checkAdminAccess, 5 * 60 * 1000); // 300000ms

        return () => clearInterval(intervalId);
    }, [router.pathname, user?.id]);

    // ── Player ──────────────────────────────────────────────
    const [currentTrack, setCurrentTrack] = useState(null);
    const [currentIndex, setCurrentIndex] = useState(-1);

    const handleTrackSelect = useCallback((track, index) => {
        setCurrentTrack(track);
        setCurrentIndex(index);
        playTrack(track, index, tracks);
    }, [playTrack, tracks]);

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
            // import tracking
            activeImport,
            startTrackingImport,
            dismissImport,
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
