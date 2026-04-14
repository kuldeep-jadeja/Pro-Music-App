import { requireAdmin } from '@/lib/requireAdmin';
import { connectDB } from '@/lib/mongodb';
import ArtistJob from '@/models/ArtistJob';
import { enqueueArtistExpand } from '@/lib/artistExpandQueue';

/**
 * POST /api/admin/retry-jobs
 *
 * Bulk retry endpoint for failed artist expansion jobs.
 *
 * Accepts a list of MongoDB `_id` values for ArtistJob documents and, for each:
 *   1. Validates the jobId is a non-empty string.
 *   2. Atomically transitions the job from `failed` → `queued` using findOneAndUpdate
 *      with the filter `{ _id: jobId, status: 'failed' }`. This ensures:
 *        - Only failed jobs are reactivated (idempotent guard).
 *        - No new ArtistJob document is created (retry reuses the existing record).
 *   3. If the update returns null, checks whether the job exists at all:
 *        - Job not found  → failed/job_not_found
 *        - Job exists but not failed (queued/running/done) → skipped/already_active
 *   4. Re-enqueues to Redis via enqueueArtistExpand (same path as initial enqueue).
 *   5. If Redis is unavailable, rolls back the status to `failed` to avoid an orphaned
 *      queued record that the worker will never process.
 *
 * Response: always HTTP 200 with { summary, results } — mixed-result bulk requests
 * never return a non-200, per CONTEXT.md decisions.
 *
 * Results preserve the input order of the request body `jobIds` array.
 *
 * Reason codes:
 *   retry_queued      — successfully reactivated and re-enqueued
 *   already_active    — job exists but is already queued, running, or done
 *   job_not_found     — no ArtistJob document found for the given _id
 *   invalid_job_id    — jobId is not a string or is not a valid ObjectId format
 *   redis_unavailable — Redis enqueue failed (status rolled back to failed)
 *
 * Authorization: requireAdmin — 401 if unauthenticated, 403 if not the admin.
 *
 * IMPORTANT: This handler NEVER calls ArtistJob.create() or new ArtistJob().
 * Retry always reactivates the existing failed record — no new documents are created.
 */
async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { jobIds } = req.body;

    if (!jobIds || !Array.isArray(jobIds) || jobIds.length === 0) {
        return res.status(400).json({ error: 'jobIds must be a non-empty array' });
    }

    await connectDB();

    const results = [];

    for (const jobId of jobIds) {
        // Step 1 — Validate jobId is a non-empty string
        if (!jobId || typeof jobId !== 'string') {
            results.push({ jobId, status: 'failed', reason: 'invalid_job_id' });
            continue;
        }

        // Step 2 — Atomic reactivation (QUEUE-04 core logic)
        // Filter { _id: jobId, status: 'failed' } means:
        //   - Job exists AND is failed → updated is the updated document (proceed to enqueue)
        //   - Job not found OR status is not failed → updated is null (check which case below)
        // findOneAndUpdate with { new: true } returns the UPDATED document on success.
        // A CastError is thrown for malformed ObjectId strings — caught and treated as invalid_job_id.
        let updated;
        try {
            updated = await ArtistJob.findOneAndUpdate(
                { _id: jobId, status: 'failed' },
                {
                    $set: {
                        status: 'queued',
                        queuedAt: new Date(),
                        retriedAt: new Date(),
                        error: null,
                    },
                },
                { new: true }
            );
        } catch (err) {
            // Invalid ObjectId format throws CastError
            results.push({ jobId, status: 'failed', reason: 'invalid_job_id' });
            continue;
        }

        // Step 3 — Handle null return (job not found or not in failed state)
        if (!updated) {
            const job = await ArtistJob.findById(jobId).lean();
            if (!job) {
                results.push({ jobId, status: 'failed', reason: 'job_not_found' });
            } else {
                // Job exists but is queued, running, or done — cannot retry
                results.push({
                    jobId,
                    artistSpotifyId: job.artistSpotifyId,
                    status: 'skipped',
                    reason: 'already_active',
                });
            }
            continue;
        }

        // Step 4 — Redis re-enqueue (after successful reactivation)
        // enqueueArtistExpand returns false if Redis is unavailable, never throws.
        const enqueued = await enqueueArtistExpand({
            artistSpotifyId: updated.artistSpotifyId,
            artistName: updated.artistName,
        });

        if (!enqueued) {
            // Redis failed — roll back the status to failed to prevent orphaned queued record.
            // The worker polls Redis exclusively; a queued DB record without a Redis entry will
            // never be processed. Rolling back keeps the DB consistent with Redis state.
            await ArtistJob.findOneAndUpdate(
                { _id: jobId },
                {
                    $set: {
                        status: 'failed',
                        error: 'redis_unavailable_on_retry',
                        queuedAt: null,
                        retriedAt: null,
                    },
                }
            );
            results.push({
                jobId,
                artistSpotifyId: updated.artistSpotifyId,
                status: 'failed',
                reason: 'redis_unavailable',
            });
            continue;
        }

        results.push({
            jobId,
            artistSpotifyId: updated.artistSpotifyId,
            artistName: updated.artistName,
            status: 'queued',
            reason: 'retry_queued',
        });
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
