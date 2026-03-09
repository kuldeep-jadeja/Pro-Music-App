import styles from '@/styles/Spinner.module.scss';

export default function Spinner({ label = 'Loading\u2026' }) {
    return <span className={styles.spinner} role="status" aria-label={label} />;
}
