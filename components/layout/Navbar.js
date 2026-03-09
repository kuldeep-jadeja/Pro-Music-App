import Link from 'next/link';
import styles from '@/styles/Navbar.module.scss';

function SearchIcon() {
    return (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
            <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
        </svg>
    );
}

export default function Navbar({ user, onLogout, onMenuToggle, isSidebarOpen }) {
    return (
        <header className={styles.navbar}>
            {/* Hamburger — visible only on mobile */}
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

            {/* Search bar — disabled for guests until search is implemented */}
            <div className={`${styles.searchWrap}${!user ? ` ${styles.searchWrapDisabled}` : ''}`}>
                <span className={styles.searchIcon}><SearchIcon /></span>
                <input
                    className={styles.searchInput}
                    type="search"
                    placeholder={user ? 'Search songs, artists, albums…' : 'Log in to search'}
                    aria-label="Search"
                    disabled={!user}
                    title={!user ? 'Log in to search' : undefined}
                    readOnly={!!user} // functional search not yet implemented; prevent input for logged-in users too
                />
            </div>

            {/* User controls */}
            <div className={styles.controls}>
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
        </header>
    );
}
