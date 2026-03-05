import { useRouter } from 'next/router';
import styles from '@/styles/MobileTabBar.module.scss';

// ── Icons ─────────────────────────────────────────────────────
function HomeIcon() {
    return (
        <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
            <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z" />
        </svg>
    );
}

function LibraryIcon() {
    return (
        <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
            <path d="M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z" />
        </svg>
    );
}

function ImportIcon() {
    return (
        <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
            <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" />
        </svg>
    );
}

function MusicNoteIcon() {
    return (
        <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
            <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
        </svg>
    );
}

export default function MobileTabBar({ user, currentTrack, activePlaylistId }) {
    const router = useRouter();
    const isHome = router.pathname === '/';
    const isPlaylistPage = router.pathname.startsWith('/playlist');

    if (!user) return null;

    const handleSectionNav = (sectionId) => {
        if (isHome) {
            document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } else {
            router.push(`/#${sectionId}`);
        }
    };

    const tabs = [
        {
            id: 'home',
            label: 'Home',
            icon: <HomeIcon />,
            active: isHome,
            disabled: false,
            onClick: () => router.push('/'),
        },
        {
            id: 'library',
            label: 'Library',
            icon: <LibraryIcon />,
            active: isPlaylistPage,
            disabled: false,
            onClick: () => handleSectionNav('playlists'),
        },
        {
            id: 'import',
            label: 'Import',
            icon: <ImportIcon />,
            active: false,
            disabled: false,
            onClick: () => handleSectionNav('import'),
        },
        {
            id: 'playing',
            label: currentTrack ? 'Now Playing' : 'Player',
            icon: currentTrack?.albumImage
                ? (
                    <img
                        src={currentTrack.albumImage}
                        alt=""
                        className={`${styles.nowPlayingArt} ${currentTrack ? styles.nowPlayingArtActive : ''}`}
                        width={26}
                        height={26}
                    />
                )
                : <MusicNoteIcon />,
            active: !!currentTrack,
            disabled: !currentTrack && !activePlaylistId,
            onClick: () => {
                if (activePlaylistId) router.push(`/playlist/${activePlaylistId}`);
            },
        },
    ];

    return (
        <nav className={styles.tabBar} aria-label="Mobile navigation">
            {tabs.map((tab) => (
                <button
                    key={tab.id}
                    className={[
                        styles.tab,
                        tab.active ? styles.tabActive : '',
                        tab.disabled ? styles.tabDisabled : '',
                    ].filter(Boolean).join(' ')}
                    onClick={tab.onClick}
                    disabled={tab.disabled}
                    aria-label={tab.label}
                    aria-current={tab.active ? 'page' : undefined}
                >
                    <span className={styles.tabIcon}>{tab.icon}</span>
                    <span className={styles.tabLabel}>{tab.label}</span>
                </button>
            ))}
        </nav>
    );
}
