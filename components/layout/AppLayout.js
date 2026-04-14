import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/router';
import Sidebar from './Sidebar';
import Navbar from './Navbar';
import Player from '@/components/Player';
import MobileTabBar from './MobileTabBar';
import NowPlayingPanel from './NowPlayingPanel';
import MobileNowPlayingSheet from './MobileNowPlayingSheet';
import { useAppContext } from '@/lib/AppContext';
import { usePlayer } from '@/context/PlayerContext';
import styles from '@/styles/AppLayout.module.scss';

export default function AppLayout({ children }) {
    const {
        user,
        handleLogout,
        playlists,
        activePlaylist,
        tracks,
        currentTrack,
        currentIndex,
        handleTrackChange,
        activeImport,
        dismissImport,
    } = useAppContext();

    const router = useRouter();
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [panelOpen, setPanelOpen] = useState(true);
    const [sheetOpen, setSheetOpen] = useState(false);

    const {
        playTrack,
        currentTrack: playerCtxTrack,
        currentIndex: playerCtxIndex,
    } = usePlayer();

    const tracksRef = useRef(tracks);
    useEffect(() => { tracksRef.current = tracks; }, [tracks]);
    const lastAppTrackId = useRef(null);
    const lastPlayerTrackId = useRef(null);

    const appTrackId = (currentTrack?._id ?? currentTrack?.id)?.toString() ?? null;
    const playerTrackId = (playerCtxTrack?._id ?? playerCtxTrack?.id)?.toString() ?? null;

    // AppContext → PlayerContext: relay user track selection to the shared player
    useEffect(() => {
        if (!appTrackId || appTrackId === lastAppTrackId.current) return;
        lastAppTrackId.current = appTrackId;
        lastPlayerTrackId.current = appTrackId;
        playTrack(currentTrack, currentIndex, tracksRef.current);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [appTrackId]);

    // PlayerContext → AppContext: keep UI in sync when track auto-advances
    useEffect(() => {
        if (!playerTrackId || playerTrackId === lastPlayerTrackId.current) return;
        lastPlayerTrackId.current = playerTrackId;
        lastAppTrackId.current = playerTrackId;
        handleTrackChange(playerCtxTrack, playerCtxIndex);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [playerTrackId]);

    // Show the floating import chip on every page except home (where ImportForm
    // already shows the matching card inline).
    const showImportChip =
        activeImport &&
        (activeImport.phase === 'matching' || activeImport.phase === 'complete') &&
        router.pathname !== '/';

    return (
        <div className={`${styles.shell}${panelOpen ? ` ${styles.shellPanelOpen}` : ''}`}>
            <Sidebar
                user={user}
                playlists={playlists}
                onPlaylistClick={(id) => router.push(`/playlist/${id}`)}
                activePlaylistId={activePlaylist?.id}
                isOpen={sidebarOpen}
                onClose={() => setSidebarOpen(false)}
            />

            {sidebarOpen && (
                <div
                    className={styles.backdrop}
                    onClick={() => setSidebarOpen(false)}
                    aria-hidden="true"
                />
            )}

            <div className={styles.body}>
                <Navbar
                    user={user}
                    onLogout={handleLogout}
                    onMenuToggle={() => setSidebarOpen((o) => !o)}
                    isSidebarOpen={sidebarOpen}
                    onPanelToggle={() => setPanelOpen((o) => !o)}
                    isPanelOpen={panelOpen}
                    currentTrack={currentTrack}
                />
                <main className={styles.content}>
                    <div className={styles.container}>
                        {children}
                    </div>
                </main>
            </div>

            <div className={styles.playerSlot}>
                <Player
                    track={currentTrack}
                    playlist={tracks}
                    currentIndex={currentIndex}
                    playlistId={activePlaylist?.id}
                    onOpenSheet={() => setSheetOpen(true)}
                />
            </div>

            <MobileTabBar
                user={user}
                currentTrack={currentTrack}
                activePlaylistId={activePlaylist?.id}
                onNowPlayingOpen={() => setSheetOpen(true)}
            />

            <MobileNowPlayingSheet
                track={currentTrack}
                isOpen={sheetOpen}
                onClose={() => setSheetOpen(false)}
            />

            <NowPlayingPanel
                currentTrack={currentTrack}
                playlist={tracks}
                currentIndex={currentIndex}
                activePlaylist={activePlaylist}
                onTrackSelect={(track, idx) => handleTrackChange(track, idx)}
                isOpen={panelOpen}
                onClose={() => setPanelOpen(false)}
            />

            {/* Floating import progress chip — visible on non-home pages */}
            {showImportChip && (
                <div className={`${styles.importChip} ${activeImport.phase === 'complete' ? styles.importChipDone : ''}`}>
                    {activeImport.coverImage && (
                        <img
                            src={activeImport.coverImage}
                            alt=""
                            className={styles.importChipCover}
                            width={32}
                            height={32}
                        />
                    )}
                    <div className={styles.importChipBody}>
                        <span className={styles.importChipName}>
                            {activeImport.phase === 'complete' ? '✓ Ready!' : activeImport.name || 'Importing…'}
                        </span>
                        {activeImport.phase === 'matching' && (
                            <>
                                <div className={styles.importChipTrack}>
                                    <div
                                        className={styles.importChipFill}
                                        style={{ width: `${activeImport.progress}%` }}
                                    />
                                </div>
                                <span className={styles.importChipPct}>{activeImport.progress}%</span>
                            </>
                        )}
                    </div>
                    <button
                        className={styles.importChipClose}
                        onClick={dismissImport}
                        aria-label={
                            activeImport.phase === 'complete'
                                ? 'Dismiss'
                                : 'Hide — import continues in background'
                        }
                        title={
                            activeImport.phase === 'complete'
                                ? 'Dismiss'
                                : 'Hide — import still running in background'
                        }
                    >
                        {activeImport.phase === 'complete' ? (
                            '×'
                        ) : (
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
                                <path d="M19 13H5v-2h14v2z" />
                            </svg>
                        )}
                    </button>
                </div>
            )}
        </div>
    );
}
