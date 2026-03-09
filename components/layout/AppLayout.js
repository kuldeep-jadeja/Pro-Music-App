import { useState } from 'react';
import { useRouter } from 'next/router';
import Sidebar from './Sidebar';
import Navbar from './Navbar';
import Player from '@/components/Player';
import MobileTabBar from './MobileTabBar';
import NowPlayingPanel from './NowPlayingPanel';
import { useAppContext } from '@/lib/AppContext';
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
    const [panelOpen, setPanelOpen] = useState(false);

    // Show the floating import chip on every page except home (where ImportForm
    // already shows the matching card inline).
    const showImportChip =
        activeImport &&
        (activeImport.phase === 'matching' || activeImport.phase === 'complete') &&
        router.pathname !== '/';

    return (
        <div className={styles.shell}>
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

            <div className={`${styles.body} ${currentTrack ? styles.bodyWithPanel : ''}`}>
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
                    onTrackChange={handleTrackChange}
                    playlistId={activePlaylist?.id}
                />
            </div>

            <MobileTabBar
                user={user}
                currentTrack={currentTrack}
                activePlaylistId={activePlaylist?.id}
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
                        aria-label="Dismiss import progress"
                    >
                        ×
                    </button>
                </div>
            )}
        </div>
    );
}
