import Head from 'next/head';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { requireAdmin } from '@/lib/requireAdmin';
import styles from '@/styles/Admin.module.scss';

function normalizeArtistName(value) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function getDisplayStatus(job) {
    if (job?.isBlocked) return 'do_not_expand';
    if (job?.status === 'not_queued') return 'ready_to_queue';
    return job?.status || 'unknown';
}

function formatStatusLabel(status) {
    return String(status || 'unknown').replace(/_/g, ' ');
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
    const [policyInFlight, setPolicyInFlight] = useState(false);
    const [policyResult, setPolicyResult] = useState(null);

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
                    queueSpotifyId: item?.queueSpotifyId || item?.artistSpotifyId || null,
                    isBlocked: Boolean(item?.isBlocked),
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
        queueSpotifyId: job.queueSpotifyId || job.artistSpotifyId || null,
        artistName: job.artistName || null,
        isBlocked: Boolean(job.isBlocked),
    })), [jobs]);
    const allVisibleSelected = useMemo(() => (
        visibleRows.length > 0 && visibleRows.every((row) => Boolean(selected[row.jobId]))
    ), [visibleRows, selected]);
    const someVisibleSelected = useMemo(() => (
        visibleRows.some((row) => Boolean(selected[row.jobId]))
    ), [visibleRows, selected]);
    const selectedCount = useMemo(() => Object.keys(selected).length, [selected]);
    const selectedQueueableCount = useMemo(
        () => Object.values(selected).filter((item) => !item?.isBlocked).length,
        [selected]
    );
    const stats = useMemo(() => {
        let blocked = 0;
        let ready = 0;
        let active = 0;
        let failed = 0;

        for (const job of jobs) {
            const visualStatus = getDisplayStatus(job);
            if (visualStatus === 'do_not_expand') blocked++;
            if (visualStatus === 'ready_to_queue') ready++;
            if (visualStatus === 'queued' || visualStatus === 'running') active++;
            if (visualStatus === 'failed') failed++;
        }

        return {
            total: jobs.length,
            blocked,
            ready,
            active,
            failed,
        };
    }, [jobs]);
    const statusClassMap = {
        do_not_expand: styles.statusBlocked,
        ready_to_queue: styles.statusReady,
        queued: styles.statusQueued,
        running: styles.statusRunning,
        done: styles.statusDone,
        failed: styles.statusFailed,
        unknown: styles.statusUnknown,
    };

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
                    queueSpotifyId: job.queueSpotifyId || job.artistSpotifyId || null,
                    artistName: job.artistName || null,
                    isBlocked: Boolean(job.isBlocked),
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
                    queueSpotifyId: row.queueSpotifyId,
                    artistName: row.artistName,
                    isBlocked: row.isBlocked,
                };
            }
            return next;
        });
    }, [allVisibleSelected, visibleRows]);

    const handleBulkQueue = useCallback(async () => {
        const selectedArtists = Object.values(selected).filter((artist) => !artist?.isBlocked);
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
                        spotifyId: artist.queueSpotifyId || artist.artistSpotifyId,
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

            if (results.some((item) => item?.status === 'queued')) {
                setSelected({});
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

    const handleBulkPolicy = useCallback(async (action) => {
        const selectedArtists = Object.values(selected);
        if (selectedArtists.length === 0 || policyInFlight) return;

        setPolicyInFlight(true);
        try {
            const response = await fetch('/api/admin/artist-blocklist', {
                method: action === 'block' ? 'POST' : 'DELETE',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    artists: selectedArtists.map((artist) => ({
                        spotifyId: artist.artistSpotifyId || artist.queueSpotifyId || null,
                        name: artist.artistName || null,
                    })),
                }),
            });

            const data = await response.json().catch(() => null);
            const summary = data?.summary || {
                total: 0,
                blocked: 0,
                unblocked: 0,
                skipped: 0,
                failed: 0,
            };
            const results = Array.isArray(data?.results) ? data.results : [];

            setPolicyResult({
                action,
                summary,
                results,
                error: response.ok ? null : 'Request failed. Please retry.',
            });

            if (response.ok) {
                setSelected({});
                if (action === 'block') {
                    setStatus('do_not_expand');
                }
            }
        } catch (_) {
            setPolicyResult({
                action,
                summary: { total: 0, blocked: 0, unblocked: 0, skipped: 0, failed: 0 },
                results: [],
                error: 'Request failed. Please retry.',
            });
        } finally {
            setPolicyInFlight(false);
            fetchJobs({ silent: true });
        }
    }, [selected, policyInFlight, fetchJobs]);

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
                    <p className={styles.adminLead}>
                        Expansion command center: control queue flow, block unwanted artists, and monitor worker outcomes.
                    </p>
                </div>

                <div className={styles.adminBody}>
                <section className={styles.jobsSection}>
                        <div className={styles.statsGrid}>
                            <article className={styles.statCard}>
                                <span className={styles.statLabel}>visible artists</span>
                                <strong className={styles.statValue}>{stats.total}</strong>
                            </article>
                            <article className={styles.statCard}>
                                <span className={styles.statLabel}>ready to queue</span>
                                <strong className={styles.statValue}>{stats.ready}</strong>
                            </article>
                            <article className={styles.statCard}>
                                <span className={styles.statLabel}>active jobs</span>
                                <strong className={styles.statValue}>{stats.active}</strong>
                            </article>
                            <article className={styles.statCard}>
                                <span className={styles.statLabel}>do not expand</span>
                                <strong className={styles.statValue}>{stats.blocked}</strong>
                            </article>
                            <article className={styles.statCard}>
                                <span className={styles.statLabel}>failed jobs</span>
                                <strong className={styles.statValue}>{stats.failed}</strong>
                            </article>
                        </div>

                        <div className={styles.controlPanel}>
                            <div className={styles.bulkControls}>
                                <div className={styles.bulkSelectionMeta}>
                                    <strong>{selectedCount}</strong> selected · <strong>{selectedQueueableCount}</strong> queueable
                                </div>
                                <div className={styles.bulkActionGroup}>
                                    <button
                                        type="button"
                                        className={styles.bulkQueueButton}
                                        disabled={selectedQueueableCount === 0 || bulkInFlight}
                                        onClick={handleBulkQueue}
                                    >
                                        {bulkInFlight ? 'Queueing…' : 'Queue Selected Artists'}
                                    </button>
                                    <button
                                        type="button"
                                        className={styles.blockButton}
                                        disabled={selectedCount === 0 || policyInFlight}
                                        onClick={() => handleBulkPolicy('block')}
                                    >
                                        {policyInFlight ? 'Saving…' : 'Mark Do Not Expand'}
                                    </button>
                                    <button
                                        type="button"
                                        className={styles.unblockButton}
                                        disabled={selectedCount === 0 || policyInFlight}
                                        onClick={() => handleBulkPolicy('unblock')}
                                    >
                                        {policyInFlight ? 'Saving…' : 'Remove Do Not Expand'}
                                    </button>
                                </div>
                            </div>

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
                                        <option value="do_not_expand">do not expand</option>
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
                        </div>

                        {(bulkResult || policyResult) ? (
                            <div className={styles.resultPanels}>
                                {bulkResult ? (
                                    <div className={styles.bulkResultPanel}>
                                        <div className={styles.bulkResultSummary}>
                                            <strong>queue result</strong> · total {bulkResult.summary?.total || 0} · queued {bulkResult.summary?.queued || 0} · skipped {bulkResult.summary?.skipped || 0} · failed {bulkResult.summary?.failed || 0}
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

                                {policyResult ? (
                                    <div className={styles.bulkResultPanel}>
                                        <div className={styles.bulkResultSummary}>
                                            <strong>{policyResult.action === 'block' ? 'policy update' : 'policy removal'}</strong>
                                            {' '}· total {policyResult.summary?.total || 0}
                                            {' '}· blocked {policyResult.summary?.blocked || 0}
                                            {' '}· unblocked {policyResult.summary?.unblocked || 0}
                                            {' '}· skipped {policyResult.summary?.skipped || 0}
                                            {' '}· failed {policyResult.summary?.failed || 0}
                                        </div>
                                        {policyResult.error ? (
                                            <div className={styles.bulkResultError}>{policyResult.error}</div>
                                        ) : null}
                                        {Array.isArray(policyResult.results) && policyResult.results.length > 0 ? (
                                            <ul className={styles.bulkResultList}>
                                                {policyResult.results.map((item, index) => (
                                                    <li key={`${item.artistSpotifyId || item.artistName || 'artist'}-policy-${index}`}>
                                                        <span className={styles.bulkResultArtist}>{item.artistName || item.artistSpotifyId || 'Unknown artist'}</span>
                                                        <span className={styles.bulkResultState}>{item.status || 'unknown'}</span>
                                                        <span className={styles.bulkResultReason}>{item.reason || 'unknown_reason'}</span>
                                                    </li>
                                                ))}
                                            </ul>
                                        ) : null}
                                    </div>
                                ) : null}
                            </div>
                        ) : null}

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
                                        {jobs.map((job) => {
                                            const displayStatus = getDisplayStatus(job);
                                            const statusClass = statusClassMap[displayStatus] || styles.statusUnknown;

                                            return (
                                            <tr
                                                key={job._id}
                                                className={job.isBlocked ? styles.rowBlocked : ''}
                                            >
                                                <td>
                                                    <label className={styles.checkboxCell}>
                                                        <input
                                                            type="checkbox"
                                                            checked={Boolean(selected[String(job._id)])}
                                                            aria-label={`Select ${job.artistName || 'unknown artist'} (${job.artistSpotifyId || job.queueSpotifyId || 'unknown Spotify ID'})`}
                                                            onChange={() => toggleRowSelection(job)}
                                                        />
                                                        <span className={styles.srOnly}>Select row</span>
                                                    </label>
                                                </td>
                                                <td>
                                                    <span className={`${styles.statusPill} ${statusClass}`}>
                                                        {formatStatusLabel(displayStatus)}
                                                    </span>
                                                </td>
                                                <td>
                                                    <div className={styles.artistCell}>
                                                        <span className={styles.artistName}>{job.artistName || 'Unknown artist'}</span>
                                                        {job.isBlocked ? (
                                                            <span className={styles.artistHint}>Excluded from cron expansion</span>
                                                        ) : null}
                                                    </div>
                                                </td>
                                                <td>{job.artistSpotifyId || job.queueSpotifyId || '—'}</td>
                                                <td>{job.updatedAt ? new Date(job.updatedAt).toLocaleString() : '—'}</td>
                                                <td>{job.error || (job.isBlocked ? 'blocked by admin' : '—')}</td>
                                                <td>
                                                    {job.isBlocked ? (
                                                        <span className={styles.blockedBadge}>Do not expand</span>
                                                    ) : job.status === 'failed' ? (
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
                                            );
                                        })}
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
