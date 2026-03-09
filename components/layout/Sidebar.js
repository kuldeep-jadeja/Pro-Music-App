import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import styles from '@/styles/Sidebar.module.scss';

function HomeIcon() {
    return (
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
            <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z" />
        </svg>
    );
}

function PlaylistIcon() {
    return (
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
            <path d="M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z" />
        </svg>
    );
}

function ImportIcon() {
    return (
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
            <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" />
        </svg>
    );
}

export default function Sidebar({
    user,
    playlists = [],
    onPlaylistClick,
    activePlaylistId,
    isOpen,
    onClose,
}) {
    const router = useRouter();
    const isHome = router.pathname === '/';

    // ── Scroll-spy: track which section is in the viewport ───
    const [activeSection, setActiveSection] = useState(null);

    useEffect(() => {
        if (!isHome) {
            setActiveSection(null);
            return;
        }

        const intersecting = new Set();

        const observer = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    if (entry.isIntersecting) {
                        intersecting.add(entry.target.id);
                    } else {
                        intersecting.delete(entry.target.id);
                    }
                });
                // Priority order matches visual page order
                if (intersecting.has('playlists')) {
                    setActiveSection('playlists');
                } else if (intersecting.has('import')) {
                    setActiveSection('import');
                } else {
                    setActiveSection(null);
                }
            },
            {
                threshold: 0.25,
                // Offset for fixed navbar height
                rootMargin: '-64px 0px 0px 0px',
            }
        );

        ['playlists', 'import'].forEach((id) => {
            const el = document.getElementById(id);
            if (el) observer.observe(el);
        });

        return () => observer.disconnect();
    }, [isHome]);

    // ── Playlist click: load + scroll to playlist view ───────
    const handlePlaylistClick = (playlistId) => {
        onPlaylistClick?.(playlistId);
        // Scroll to the active playlist view after React renders it
        setTimeout(() => {
            document.getElementById('playlist-view')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 80);
    };

    // ── Section nav: smooth-scroll when already on home ──────
    const handleSectionClick = (e, sectionId) => {
        if (!user) return; // let Link redirect to /login
        if (isHome) {
            e.preventDefault();
            document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        onClose?.(); // close mobile sidebar in all cases
    };

    // ── Active state helpers ──────────────────────────────────
    const isNavActive = (section) => {
        if (!isHome) return false;
        if (section === 'home') return activeSection === null;
        return activeSection === section;
    };

    // For guests: redirect Playlists/Import links to login
    const sectionHref = (section) => (user ? `/#${section}` : '/login');
    const sectionTitle = (section) =>
        !user ? `Sign in to access ${section}` : undefined;

    return (
        <aside className={`${styles.sidebar}${isOpen ? ` ${styles.open}` : ''}`}>
            {/* Logo */}
            <div className={styles.logo}>
                <svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor" className={styles.logoIcon} aria-hidden="true">
                    <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
                </svg>
                <span className={styles.logoText}>Demus</span>
            </div>

            {/* Primary navigation */}
            <nav className={styles.nav} aria-label="Main navigation">
                <p className={styles.navLabel}>Menu</p>

                <Link
                    href="/"
                    className={`${styles.navItem} ${isNavActive('home') ? styles.active : ''}`}
                >
                    <HomeIcon />
                    <span>Home</span>
                </Link>

                <Link
                    href={sectionHref('playlists')}
                    className={`${styles.navItem} ${isNavActive('playlists') ? styles.active : ''} ${!user ? styles.navItemGuest : ''}`}
                    title={sectionTitle('playlists')}
                    onClick={(e) => handleSectionClick(e, 'playlists')}
                >
                    <PlaylistIcon />
                    <span>Playlists</span>
                    {!user && <span className={styles.lockHint} aria-hidden="true">🔒</span>}
                </Link>

                <Link
                    href={sectionHref('import')}
                    className={`${styles.navItem} ${isNavActive('import') ? styles.active : ''} ${!user ? styles.navItemGuest : ''}`}
                    title={sectionTitle('import')}
                    onClick={(e) => handleSectionClick(e, 'import')}
                >
                    <ImportIcon />
                    <span>Import</span>
                    {!user && <span className={styles.lockHint} aria-hidden="true">🔒</span>}
                </Link>
            </nav>

            {/* Library — playlist list */}
            {user && playlists.length > 0 && (
                <div className={styles.library}>
                    <p className={styles.navLabel}>Your Library</p>
                    <div className={styles.playlistList}>
                        {playlists.map((pl) => (
                            <button
                                key={pl.id}
                                className={`${styles.playlistItem} ${activePlaylistId === pl.id ? styles.playlistActive : ''}`}
                                onClick={() => handlePlaylistClick(pl.id)}
                                title={pl.name}
                            >
                                {pl.coverImage ? (
                                    <img
                                        src={pl.coverImage}
                                        alt=""
                                        className={styles.plCover}
                                        width={36}
                                        height={36}
                                    />
                                ) : (
                                    <div className={styles.plCoverPlaceholder} aria-hidden="true" />
                                )}
                                <span className={styles.plName}>{pl.name}</span>
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* User strip */}
            {user && (
                <div className={styles.userInfo}>
                    <div className={styles.avatar} aria-hidden="true">
                        {user.email?.[0]?.toUpperCase()}
                    </div>
                    <span className={styles.userEmail}>{user.email}</span>
                </div>
            )}
        </aside>
    );
}
