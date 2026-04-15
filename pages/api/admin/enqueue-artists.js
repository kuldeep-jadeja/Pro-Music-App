import { requireAdmin } from '@/lib/requireAdmin';
import { connectDB } from '@/lib/mongodb';
import ArtistJob from '@/models/ArtistJob';
import { enqueueArtistExpand } from '@/lib/artistExpandQueue';
import { resolveArtistTarget } from '@/lib/admin/resolveArtistTarget';

/**
 * POST /api/admin/enqueue-artists
 *
 * Idempotent bulk artist expansion enqueue endpoint.
 *
 * Accepts a list of artists and, for each one:
 *   1. Validates that a spotifyId is present.
 *   2. Deduplicates within the payload (first occurrence wins).
 *   3. Checks for an existing active job (queued or running) — skips if one exists.
 *   4. Enqueues to Redis FIRST (fail fast before DB write to avoid orphaned records).
 *   5. Upserts the ArtistJob document to `queued` status.
 *
 * Response: always HTTP 200 with { summary, results } — mixed-result bulk requests
 * never return a non-200, per CONTEXT.md decisions.
 *
 * Results preserve the input order of the request body `artists` array.
 *
 * Reason codes:
 *   queued           — successfully enqueued (new or re-enqueue from done/failed)
 *   already_active   — skipped because a queued or running job already exists
 *   missing_artist_id — failed because no spotifyId was provided
 *   invalid_artist_spotify_id — failed because spotifyId could not resolve to an artist
 *   redis_unavailable — failed because Redis enqueue returned false (Redis down)
 *   db_error         — failed due to an unexpected MongoDB error
 *
 * Authorization: requireAdmin — 401 if unauthenticated, 403 if not the admin.
 */
async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { artists } = req.body;

    if (!artists || !Array.isArray(artists) || artists.length === 0) {
        return res.status(400).json({ error: 'artists must be a non-empty array' });
    }

    await connectDB();

    const results = [];
    // Within-payload deduplication — first occurrence processed, subsequent skipped.
    const seen = new Set();

    for (const artist of artists) {
        const requestedSpotifyId = typeof artist?.spotifyId === 'string' ? artist.spotifyId.trim() : '';

        // Step 1 — Validate required field
        if (!requestedSpotifyId) {
            results.push({
                artistSpotifyId: null,
                artistName: null,
                status: 'failed',
                reason: 'missing_artist_id',
            });
            continue;
        }

        // Step 1.5 — Resolve canonical artist target.
        // Accept artist IDs directly, and remap track IDs to their primary artist ID.
        const resolvedTarget = await resolveArtistTarget({
            spotifyId: requestedSpotifyId,
            artistName: artist?.name || null,
        });
        if (!resolvedTarget?.artistSpotifyId) {
            results.push({
                artistSpotifyId: requestedSpotifyId,
                artistName: null,
                status: 'failed',
                reason: 'invalid_artist_spotify_id',
            });
            continue;
        }

        const artistSpotifyId = resolvedTarget.artistSpotifyId;
        const artistName = resolvedTarget.artistName || null;

        // Step 2 — Within-payload deduplication
        if (seen.has(artistSpotifyId)) {
            results.push({
                artistSpotifyId,
                artistName,
                status: 'skipped',
                reason: 'already_active',
            });
            continue;
        }
        seen.add(artistSpotifyId);

        // Step 3 — Atomic active-job check (QUEUE-02 idempotency guard)
        // Uses findOneAndUpdate so the check and any touch are atomic.
        const existingActive = await ArtistJob.findOneAndUpdate(
            { artistSpotifyId, status: { $in: ['queued', 'running'] } },
            { $set: { updatedAt: new Date() } },
            { returnDocument: 'before' }
        );
        if (existingActive) {
            results.push({
                artistSpotifyId,
                artistName,
                status: 'skipped',
                reason: 'already_active',
            });
            continue;
        }

        // Step 4 — Redis enqueue FIRST (fail fast before persisting)
        // If Redis is unavailable, enqueueArtistExpand returns false and never throws.
        // We must NOT persist the ArtistJob as queued when Redis is down — the worker
        // will never pick it up (Redis is the delivery mechanism).
        const enqueued = await enqueueArtistExpand({
            artistSpotifyId,
            artistName,
        });
        if (!enqueued) {
            results.push({
                artistSpotifyId,
                artistName,
                status: 'failed',
                reason: 'redis_unavailable',
            });
            continue;
        }

        // Step 5 — Upsert ArtistJob to queued state (only reached if Redis enqueue succeeded)
        // Filter: status NOT IN ['queued', 'running'] — allows re-enqueue from done/failed,
        // but if a concurrent request already transitioned to queued/running, the filter
        // won't match and upsert will insert a new doc — the unique index catches that race
        // and throws E11000 (code 11000), which we handle below.
        try {
            const setFields = {
                status: 'queued',
                queuedAt: new Date(),
                error: null,
            };
            if (artistName) {
                setFields.artistName = artistName;
            }

            await ArtistJob.findOneAndUpdate(
                { artistSpotifyId, status: { $nin: ['queued', 'running'] } },
                {
                    $set: setFields,
                },
                { upsert: true, returnDocument: 'after' }
            );
            results.push({
                artistSpotifyId,
                artistName,
                status: 'queued',
                reason: 'queued',
            });
        } catch (err) {
            if (err.code === 11000) {
                // Concurrent upsert race — another request won and transitioned the job to
                // queued/running between our active-job check and the upsert. Treat as skipped.
                results.push({
                    artistSpotifyId,
                    artistName,
                    status: 'skipped',
                    reason: 'already_active',
                });
            } else {
                results.push({
                    artistSpotifyId,
                    artistName,
                    status: 'failed',
                    reason: 'db_error',
                });
            }
        }
    }

    // Summary counts across all per-item results
    const summary = {
        total: results.length,
        queued: results.filter(r => r.status === 'queued').length,
        skipped: results.filter(r => r.status === 'skipped').length,
        failed: results.filter(r => r.status === 'failed').length,
    };

    // Always return 200 — mixed-result bulk requests never use 4xx/5xx per CONTEXT.md.
    return res.status(200).json({ summary, results });
}

export default requireAdmin(handler);
