import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import styles from '@/styles/Navbar.module.scss';

function SearchIcon() {
    return (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
            <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
        </svg>
    );
}

function BellIcon() {
    return (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
            <path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.63-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z" />
        </svg>
    );
}

function PanelOpenIcon() {
    return (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
            <path d="M3 3h18v2H3zm0 16h18v2H3zm0-8h10v2H3zm14 0l4-4v8l-4-4z" />
        </svg>
    );
}

function PanelCloseIcon() {
    return (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
            <path d="M3 3h18v2H3zm0 16h18v2H3zm0-8h10v2H3zm18-4l-4 4 4 4V7z" />
        </svg>
    );
}

function LogoutIcon() {
    return (
        <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true">
            <path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5-5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z" />
        </svg>
    );
}

export default function Navbar({ user, onLogout, onMenuToggle, isSidebarOpen, onPanelToggle, isPanelOpen, currentTrack }) {
    const userInitial = user?.email?.[0]?.toUpperCase() ?? '?';
    const [avatarMenuOpen, setAvatarMenuOpen] = useState(false);
    const avatarRef = useRef(null);

    // Close dropdown when clicking outside
    useEffect(() => {
        if (!avatarMenuOpen) return;
        function handleOutside(e) {
            if (avatarRef.current && !avatarRef.current.contains(e.target)) {
                setAvatarMenuOpen(false);
            }
        }
        document.addEventListener('mousedown', handleOutside);
        return () => document.removeEventListener('mousedown', handleOutside);
    }, [avatarMenuOpen]);

    return (
        <header className={styles.navbar}>
            {/* Hamburger — mobile only */}
            <button
                className={styles.hamburger}
                onClick={onMenuToggle}
                aria-label="Toggle navigation"
                aria-expanded={isSidebarOpen}
            >
                <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
                    <path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z" />
                </svg>
            </button>

            {/* Brand — mobile only, centered absolutely */}
            <span className={styles.mobileBrand} aria-hidden="true">Demus</span>

            {/* Search bar — desktop only */}
            <div className={`${styles.searchWrap}${!user ? ` ${styles.searchWrapDisabled}` : ''}`}>
                <span className={styles.searchIcon}><SearchIcon /></span>
                <input
                    className={styles.searchInput}
                    type="search"
                    placeholder={user ? 'Search songs, artists, albums…' : 'Log in to search'}
                    aria-label="Search"
                    disabled={!user}
                    title={!user ? 'Log in to search' : undefined}
                    readOnly={!!user}
                />
            </div>

            {/* Desktop right controls */}
            <div className={styles.controls}>
                {onPanelToggle && (
                    <button
                        className={`${styles.panelToggle}${isPanelOpen ? ` ${styles.panelToggleActive}` : ''}`}
                        onClick={onPanelToggle}
                        aria-label={isPanelOpen ? 'Close Now Playing panel' : 'Open Now Playing panel'}
                        title="Now Playing"
                    >
                        {isPanelOpen ? <PanelCloseIcon /> : <PanelOpenIcon />}
                    </button>
                )}

                <button className={styles.bellBtn} aria-label="Notifications">
                    <BellIcon />
                    {currentTrack && <span className={styles.bellDot} aria-hidden="true" />}
                </button>

                <span className={styles.separator} aria-hidden="true" />

                {user ? (
                    <>
                        <span className={styles.email}>{user.email}</span>
                        <button className={styles.logoutBtn} onClick={onLogout}>
                            Log out
                        </button>
                    </>
                ) : (
                    <>
                        <Link href="/login" className={styles.link}>Log in</Link>
                        <Link href="/signup" className={styles.authBtn}>Sign up</Link>
                    </>
                )}
            </div>

            {/* Mobile right controls — compact icon row */}
            <div className={styles.mobileControls}>
                <button className={styles.mobileSearchBtn} aria-label="Search">
                    <SearchIcon />
                </button>

                <button className={styles.bellBtn} aria-label="Notifications">
                    <BellIcon />
                    {currentTrack && <span className={styles.bellDot} aria-hidden="true" />}
                </button>

                {user ? (
                    <div className={styles.avatarWrap} ref={avatarRef}>
                        <button
                            className={styles.avatarBtn}
                            onClick={() => setAvatarMenuOpen(o => !o)}
                            aria-label="Account menu"
                            aria-expanded={avatarMenuOpen}
                            aria-haspopup="menu"
                        >
                            {userInitial}
                        </button>
                        {avatarMenuOpen && (
                            <div className={styles.avatarMenu} role="menu">
                                <div className={styles.avatarMenuEmail}>{user.email}</div>
                                <div className={styles.avatarMenuDivider} aria-hidden="true" />
                                <button
                                    className={styles.avatarMenuLogout}
                                    role="menuitem"
                                    onClick={() => { setAvatarMenuOpen(false); onLogout(); }}
                                >
                                    <LogoutIcon />
                                    Log out
                                </button>
                            </div>
                        )}
                    </div>
                ) : (
                    <Link href="/login" className={styles.mobileLoginBtn}>
                        Log in
                    </Link>
                )}
            </div>
        </header>
    );
}
