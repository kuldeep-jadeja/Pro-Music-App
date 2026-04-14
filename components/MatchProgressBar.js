import styles from '@/styles/MatchProgressBar.module.scss';

export default function MatchProgressBar({ matched, total, percent, label }) {
    const pct = percent ?? (total > 0 ? Math.round((matched / total) * 100) : 0);
    const text = label ?? `${matched}\u202f/\u202f${total} matched`;

    return (
        <div className={styles.wrap}>
            <div className={styles.track}>
                <div className={styles.fill} style={{ width: `${pct}%` }} />
            </div>
            <span className={styles.label}>{text}</span>
        </div>
    );
}
