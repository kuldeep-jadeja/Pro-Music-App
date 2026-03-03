import styles from '@/styles/Navbar.module.scss';

export default function Navbar() {
    return (
        <nav className={styles.navbar}>
            <div className={styles.logo}>
                <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor">
                    <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
                </svg>
                <span className={styles.brand}>Demus</span>
            </div>
            <div className={styles.links}>
                <a href="/" className={styles.link}>Home</a>
            </div>
        </nav>
    );
}
