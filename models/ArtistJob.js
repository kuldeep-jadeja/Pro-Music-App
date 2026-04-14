/**
 * ArtistJob — per-artist expansion job state store.
 *
 * One document per artist (enforced by the unique index on `artistSpotifyId`).
 * Tracks the lifecycle of an admin-triggered artist expansion job from queue
 * through worker processing to completion or failure.
 *
 * Used by:
 *   - pages/api/admin/enqueue-artists.js  (Phase 2, Plan 02) — creates/reactivates jobs
 *   - pages/api/admin/retry-jobs.js       (Phase 2, Plan 03) — reactivates failed jobs
 *   - pages/admin/artist-jobs.js          (Phase 3) — dashboard queries by status
 *   - workers/artistExpandWorker.js       (Phase 2, Plan 04) — transitions running → done/failed
 *
 * Status lifecycle:
 *   queued → running → done
 *                    ↓
 *                  failed → queued (admin retry)
 *
 * Concurrent upsert races that slip past the application-level active check
 * will throw MongoServerError E11000 (code 11000). Callers must catch this
 * and treat it as `already_active` (skipped).
 */

import mongoose from 'mongoose';

const ArtistJobSchema = new mongoose.Schema(
    {
        // Idempotency key — unique at DB level so only ONE record per artist ever exists.
        // Upsert-based enqueue always updates or inserts into the SAME document.
        // Retry reactivates this same document (never creates a new one).
        artistSpotifyId: {
            type: String,
            required: true,
            unique: true,
            index: true,
        },

        artistName: {
            type: String,
            default: null,
        },

        // Status enum matches CONTEXT.md decisions exactly.
        // index: true enables Phase 3 dashboard queries to filter by status efficiently.
        status: {
            type: String,
            enum: ['queued', 'running', 'done', 'failed'],
            default: 'queued',
            index: true,
        },

        // Stores the failure reason for Phase 3 dashboard display (VIS-03).
        // Cleared (set to null) on every successful enqueue or retry.
        error: {
            type: String,
            default: null,
        },

        // Set when the job is enqueued (both initial enqueue and retry re-enqueue).
        queuedAt: { type: Date, default: null },

        // Set by the worker when it begins processing the job.
        startedAt: { type: Date, default: null },

        // Set by the worker when the job finishes successfully (status → done).
        completedAt: { type: Date, default: null },

        // Set when an admin manually retries a failed job via retry-jobs endpoint.
        // Distinct from queuedAt — queuedAt is updated on every enqueue,
        // retriedAt is only set during an explicit admin retry action.
        retriedAt: { type: Date, default: null },
    },
    { timestamps: true }   // adds createdAt and updatedAt automatically
);

export default mongoose.models.ArtistJob ||
    mongoose.model('ArtistJob', ArtistJobSchema);
