import Head from 'next/head';
import { useCallback, useEffect, useMemo, useState } from 'react';
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
    const [status, setStatus] = useState('all');
    const [query, setQuery] = useState('');
    const [debouncedQuery, setDebouncedQuery] = useState('');
    const [jobs, setJobs] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState('');
    const [retryFeedback, setRetryFeedback] = useState({});
    const [retryInFlight, setRetryInFlight] = useState({});

    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedQuery(query.trim());
        }, 250);

        return () => clearTimeout(timer);
    }, [query]);

    const fetchJobs = useCallback(async ({ silent = false } = {}) => {
        if (!silent) {
            setIsLoading(true);
        }
        setLoadError('');

        try {
            const params = new URLSearchParams();
            params.set('status', status);
            params.set('q', debouncedQuery);

            const response = await fetch(`/api/admin/artist-jobs?${params.toString()}`);
            if (!response.ok) throw new Error('jobs_fetch_failed');

            const data = await response.json();
            setJobs(Array.isArray(data.items) ? data.items : []);
        } catch (error) {
            setJobs([]);
            setLoadError('We couldn’t load expansion jobs. Refresh the dashboard. If this persists, retry in a moment and check worker/DB health.');
        } finally {
            if (!silent) {
                setIsLoading(false);
            }
        }
    }, [jobs]);

    useEffect(() => {
        fetchJobs();
    }, [fetchJobs]);

    useEffect(() => {
        const pollId = setInterval(() => {
            fetchJobs({ silent: true });
        }, 15000);

        return () => clearInterval(pollId);
    }, [fetchJobs]);

    const handleRetry = useCallback(async (jobId) => {
        const confirmed = window.confirm('Retry Failed Job: Requeue this failed expansion job now?');
        if (!confirmed) return;

        setRetryInFlight((prev) => ({ ...prev, [jobId]: true }));
        setRetryFeedback((prev) => ({ ...prev, [jobId]: '' }));

        try {
            const response = await fetch('/api/admin/retry-jobs', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    jobIds: [jobId],
                }),
            });

            const data = await response.json().catch(() => null);
            const result = Array.isArray(data?.results) ? data.results.find((item) => item?.jobId === jobId) : null;
            const reason = result?.reason || 'unknown';

            setRetryFeedback((prev) => ({ ...prev, [jobId]: reason }));
        } catch (error) {
            setRetryFeedback((prev) => ({ ...prev, [jobId]: 'request_failed' }));
        } finally {
            setRetryInFlight((prev) => ({ ...prev, [jobId]: false }));
            fetchJobs({ silent: true });
        }
    }, [fetchJobs]);

    useEffect(() => {
        setRetryFeedback((prev) => {
            const activeJobIds = new Set(jobs.map((job) => String(job._id)));
            const next = {};
            for (const [jobId, message] of Object.entries(prev)) {
                if (activeJobIds.has(jobId)) {
                    next[jobId] = message;
                }
            }
            return next;
        });
    }, [status, debouncedQuery]);

    const hasActiveFilters = useMemo(() => status !== 'all' || debouncedQuery.length > 0, [status, debouncedQuery]);

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
                    <section className={styles.jobsSection}>
                        <div className={styles.filterBar}>
                            <label className={styles.filterLabel}>
                                Status
                                <select
                                    className={styles.filterSelect}
                                    value={status}
                                    onChange={(event) => setStatus(event.target.value)}
                                >
                                    <option value="all">all</option>
                                    <option value="queued">queued</option>
                                    <option value="running">running</option>
                                    <option value="done">done</option>
                                    <option value="failed">failed</option>
                                </select>
                            </label>

                            <label className={styles.filterLabel}>
                                Search
                                <input
                                    className={styles.filterInput}
                                    type="text"
                                    value={query}
                                    onChange={(event) => setQuery(event.target.value)}
                                    placeholder="Search artist name or Spotify ID"
                                />
                            </label>
                        </div>

                        {isLoading ? (
                            <div className={styles.infoState}>Loading expansion jobs...</div>
                        ) : null}

                        {!isLoading && loadError ? (
                            <div className={styles.errorState}>{loadError}</div>
                        ) : null}

                        {!isLoading && !loadError && jobs.length === 0 ? (
                            <div className={styles.emptyState}>
                                <h2>{hasActiveFilters ? 'No jobs match these filters' : 'No expansion jobs yet'}</h2>
                                <p>
                                    {hasActiveFilters
                                        ? 'Adjust status or search text to see matching jobs.'
                                        : 'Select artists and queue expansion to start tracking job status here.'}
                                </p>
                            </div>
                        ) : null}

                        {!isLoading && !loadError && jobs.length > 0 ? (
                            <div className={styles.tableWrap}>
                                <table className={styles.table}>
                                    <thead>
                                        <tr>
                                            <th>Status</th>
                                            <th>Artist</th>
                                            <th>Artist Spotify ID</th>
                                            <th>Last Updated</th>
                                            <th>Error</th>
                                            <th>Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {jobs.map((job) => (
                                            <tr key={job._id}>
                                                <td>{job.status || '—'}</td>
                                                <td>{job.artistName || '—'}</td>
                                                <td>{job.artistSpotifyId || '—'}</td>
                                                <td>{job.updatedAt ? new Date(job.updatedAt).toLocaleString() : '—'}</td>
                                                <td>{job.error || '—'}</td>
                                                <td>
                                                    <button
                                                        className={styles.retryButton}
                                                        type="button"
                                                        disabled={job.status !== 'failed' || Boolean(retryInFlight[job._id])}
                                                        onClick={() => handleRetry(job._id)}
                                                    >
                                                        Retry Failed Job
                                                    </button>
                                                    {retryFeedback[job._id] ? (
                                                        <div className={styles.actionFeedback}>{retryFeedback[job._id]}</div>
                                                    ) : null}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        ) : null}
                    </section>
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
