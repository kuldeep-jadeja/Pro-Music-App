import Head from 'next/head';
import { requireAdmin } from '@/lib/requireAdmin';
import styles from '@/styles/Admin.module.scss';

/**
 * /admin — Admin landing page
 *
 * This page is protected by two layers:
 *   1. middleware.js wildcard guard (JWT validity + admin email check)
 *   2. getServerSideProps using requireAdmin (server-side 403 enforcement)
 *
 * Unauthenticated users never reach this — middleware sends them to /login.
 * Non-admin authenticated users never reach this — middleware sends them to /?adminAccess=required.
 * This double-check via requireAdmin in getServerSideProps adds defense-in-depth.
 */
export default function AdminDashboard({ adminEmail }) {
    return (
        <>
            <Head>
                <title>Admin — Demus</title>
                <meta name="robots" content="noindex" />
            </Head>

            <div className={styles.adminWrap}>
                <div className={styles.adminHeader}>
                    <div className={styles.adminBadge}>Admin</div>
                    <h1 className={styles.adminTitle}>Admin Dashboard</h1>
                    <p className={styles.adminSubtitle}>
                        Signed in as <strong>{adminEmail}</strong>
                    </p>
                </div>

                <div className={styles.adminBody}>
                    <p className={styles.adminPlaceholder}>
                        Artist expansion controls will appear here in the next phase.
                    </p>
                </div>
            </div>
        </>
    );
}

/**
 * Server-side guard: requireAdmin enforces 403 for non-admin users.
 * Defense-in-depth alongside the middleware wildcard policy.
 */
export function getServerSideProps(context) {
    return new Promise((resolve) => {
        const fakeReq = context.req;
        const fakeRes = {
            _statusCode: null,
            status(code) {
                this._statusCode = code;
                return this;
            },
            json() {
                // Non-admin: redirect to home with denial flag
                resolve({
                    redirect: {
                        destination: '/?adminAccess=required',
                        permanent: false,
                    },
                });
            },
        };

        requireAdmin(async (req) => {
            resolve({
                props: {
                    adminEmail: req.user?.email || '',
                },
            });
        })(fakeReq, fakeRes);
    });
}
