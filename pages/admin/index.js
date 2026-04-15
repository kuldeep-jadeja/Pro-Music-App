import Head from 'next/head';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { requireAdmin } from '@/lib/requireAdmin';
import styles from '@/styles/Admin.module.scss';

function normalizeArtistName(value) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

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
    const [selected, setSelected] = useState({});
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState('');
    const [retryFeedback, setRetryFeedback] = useState({});
    const [retryInFlight, setRetryInFlight] = useState({});
    const [bulkInFlight, setBulkInFlight] = useState(false);
    const [bulkResult, setBulkResult] = useState(null);

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
            const normalizedItems = Array.isArray(data.items)
                ? data.items.map((item) => ({
                    ...item,
                    artistName: normalizeArtistName(item?.artistName),
                }))
                : [];
            setJobs(normalizedItems);
        } catch (error) {
            setJobs([]);
            setLoadError('We couldn’t load expansion jobs. Refresh the dashboard. If this persists, retry in a moment and check worker/DB health.');
        } finally {
            if (!silent) {
                setIsLoading(false);
            }
        }
    }, [status, debouncedQuery]);

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
        const visibleJobIds = new Set(jobs.map((job) => String(job._id)));

        setSelected((prev) => {
            const next = {};
            for (const [jobId, artist] of Object.entries(prev)) {
                if (visibleJobIds.has(jobId)) {
                    next[jobId] = artist;
                }
            }
            return next;
        });

        setRetryFeedback((prev) => {
            const next = {};
            for (const [jobId, message] of Object.entries(prev)) {
                if (visibleJobIds.has(jobId)) {
                    next[jobId] = message;
                }
            }
            return next;
        });
    }, [jobs]);

    const hasActiveFilters = useMemo(() => status !== 'all' || debouncedQuery.length > 0, [status, debouncedQuery]);
    const visibleRows = useMemo(() => jobs.map((job) => ({
        jobId: String(job._id),
        artistSpotifyId: job.artistSpotifyId || null,
        artistName: job.artistName || null,
    })), [jobs]);
    const allVisibleSelected = useMemo(() => (
        visibleRows.length > 0 && visibleRows.every((row) => Boolean(selected[row.jobId]))
    ), [visibleRows, selected]);
    const someVisibleSelected = useMemo(() => (
        visibleRows.some((row) => Boolean(selected[row.jobId]))
    ), [visibleRows, selected]);
    const selectedCount = useMemo(() => Object.keys(selected).length, [selected]);

    const toggleRowSelection = useCallback((job) => {
        const jobId = String(job._id);
        setSelected((prev) => {
            if (prev[jobId]) {
                const next = { ...prev };
                delete next[jobId];
                return next;
            }
            return {
                ...prev,
                [jobId]: {
                    artistSpotifyId: job.artistSpotifyId || null,
                    artistName: job.artistName || null,
                },
            };
        });
    }, []);

    const toggleSelectAllVisible = useCallback(() => {
        setSelected((prev) => {
            if (allVisibleSelected) {
                const next = { ...prev };
                for (const row of visibleRows) {
                    delete next[row.jobId];
                }
                return next;
            }

            const next = { ...prev };
            for (const row of visibleRows) {
                next[row.jobId] = {
                    artistSpotifyId: row.artistSpotifyId,
                    artistName: row.artistName,
                };
            }
            return next;
        });
    }, [allVisibleSelected, visibleRows]);

    const handleBulkQueue = useCallback(async () => {
        const selectedArtists = Object.values(selected);
        if (selectedArtists.length === 0 || bulkInFlight) return;

        setBulkInFlight(true);

        try {
            const response = await fetch('/api/admin/enqueue-artists', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    artists: selectedArtists.map((artist) => ({
                        spotifyId: artist.artistSpotifyId,
                        name: artist.artistName,
                    })),
                }),
            });

            const data = await response.json().catch(() => null);
            const summary = data?.summary || { total: 0, queued: 0, skipped: 0, failed: 0 };
            const results = Array.isArray(data?.results) ? data.results : [];

            setBulkResult({
                summary,
                results,
            });

            const queuedSpotifyIds = new Set(
                results
                    .filter((item) => item?.status === 'queued' && item?.artistSpotifyId)
                    .map((item) => item.artistSpotifyId)
            );

            if (queuedSpotifyIds.size > 0) {
                setSelected((prev) => {
                    const next = { ...prev };
                    for (const [jobId, artist] of Object.entries(prev)) {
                        if (queuedSpotifyIds.has(artist?.artistSpotifyId)) {
                            delete next[jobId];
                        }
                    }
                    return next;
                });
            }

            if (!response.ok) {
                throw new Error('bulk_enqueue_failed');
            }
        } catch (error) {
            setBulkResult({
                summary: { total: 0, queued: 0, skipped: 0, failed: 0 },
                results: [],
                error: 'Bulk enqueue failed. Please retry.',
            });
        } finally {
            setBulkInFlight(false);
            fetchJobs({ silent: true });
        }
    }, [selected, bulkInFlight, fetchJobs]);

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
                        <div className={styles.bulkControls}>
                            <div className={styles.bulkSelectionMeta}>{selectedCount} selected</div>
                            <button
                                type="button"
                                className={styles.bulkQueueButton}
                                disabled={selectedCount === 0 || bulkInFlight}
                                onClick={handleBulkQueue}
                            >
                                {bulkInFlight ? 'Queueing…' : 'Queue Selected Artists'}
                            </button>
                        </div>

                        {bulkResult ? (
                            <div className={styles.bulkResultPanel}>
                                <div className={styles.bulkResultSummary}>
                                    <strong>summary</strong> · total {bulkResult.summary?.total || 0} · queued {bulkResult.summary?.queued || 0} · skipped {bulkResult.summary?.skipped || 0} · failed {bulkResult.summary?.failed || 0}
                                </div>
                                {bulkResult.error ? (
                                    <div className={styles.bulkResultError}>{bulkResult.error}</div>
                                ) : null}
                                {Array.isArray(bulkResult.results) && bulkResult.results.length > 0 ? (
                                    <ul className={styles.bulkResultList}>
                                        {bulkResult.results.map((item, index) => (
                                            <li key={`${item.artistSpotifyId || item.artistName || 'artist'}-${index}`}>
                                                <span className={styles.bulkResultArtist}>{item.artistName || item.artistSpotifyId || 'Unknown artist'}</span>
                                                <span className={styles.bulkResultState}>{item.status || 'unknown'}</span>
                                                <span className={styles.bulkResultReason}>{item.reason || 'unknown_reason'}</span>
                                            </li>
                                        ))}
                                    </ul>
                                ) : null}
                            </div>
                        ) : null}

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
                                            <th>
                                                <label className={styles.checkboxCell} aria-label="select all visible">
                                                    <input
                                                        type="checkbox"
                                                        checked={allVisibleSelected}
                                                        ref={(node) => {
                                                            if (node) node.indeterminate = !allVisibleSelected && someVisibleSelected;
                                                        }}
                                                        onChange={toggleSelectAllVisible}
                                                    />
                                                    <span>select all visible</span>
                                                </label>
                                            </th>
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
                                                <td>
                                                    <label className={styles.checkboxCell}>
                                                        <input
                                                            type="checkbox"
                                                            checked={Boolean(selected[String(job._id)])}
                                                            aria-label={`Select ${job.artistName || 'unknown artist'} (${job.artistSpotifyId || 'unknown Spotify ID'})`}
                                                            onChange={() => toggleRowSelection(job)}
                                                        />
                                                        <span className={styles.srOnly}>Select row</span>
                                                    </label>
                                                </td>
                                                <td>{job.status || '—'}</td>
                                                <td>{job.artistName || 'Unknown artist'}</td>
                                                <td>{job.artistSpotifyId || '—'}</td>
                                                <td>{job.updatedAt ? new Date(job.updatedAt).toLocaleString() : '—'}</td>
                                                <td>{job.error || '—'}</td>
                                                <td>
                                                    {job.status === 'failed' ? (
                                                        <button
                                                            className={styles.retryButton}
                                                            type="button"
                                                            disabled={Boolean(retryInFlight[job._id])}
                                                            onClick={() => handleRetry(job._id)}
                                                        >
                                                            Retry Failed Job
                                                        </button>
                                                    ) : (
                                                        <span className={styles.actionPlaceholder}>—</span>
                                                    )}
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
