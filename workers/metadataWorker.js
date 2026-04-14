'use strict';

const fs = require('fs');
const path = require('path');
const Redis = require('ioredis');
const mongoose = require('mongoose');

(function loadEnvLocal() {
    if (process.env.REDIS_URL && process.env.MONGODB_URI) return;
    const envPath = path.resolve(__dirname, '..', '.env.local');
    if (!fs.existsSync(envPath)) return;

    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx === -1) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim();
        if (!process.env[key]) process.env[key] = val;
    }
}());

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const MONGODB_URI = process.env.MONGODB_URI;
const QUEUE_KEY = 'demus:metadata:queue';
const BLPOP_TIMEOUT_SECONDS = 5;
const JOB_DELAY_MS = 500;
const isDev = process.env.NODE_ENV !== 'production';

const SHADOW_MODE_VALUES = new Set(['1', 'true', 'yes', 'on']);
const SHADOW_MODE = SHADOW_MODE_VALUES.has(
    String(process.env.METADATA_WORKER_SHADOW_MODE || 'true').toLowerCase()
);

const TrackSchema = new mongoose.Schema(
    {
        spotifyId: String,
        album: String,
        albumImage: String,
        genres: {
            type: [String],
            default: [],
        },
        primaryGenre: {
            type: String,
            default: null,
        },
        genreConfidence: {
            type: Number,
            default: null,
        },
        metadataFingerprint: {
            type: String,
            default: null,
        },
        metadataSources: {
            genre: String,
            album: String,
        },
        metadataUpdatedAt: {
            type: Date,
            default: null,
        },
        metadataAttempts: {
            type: Number,
            default: 0,
        },
    },
    { timestamps: true }
);

let Track;

function log(msg) {
    if (isDev) console.log(`[metadataWorker] ${msg}`);
}

function logWarn(msg) {
    console.warn(`[metadataWorker] WARN ${msg}`);
}

function logError(msg, err) {
    console.error(`[metadataWorker] ERROR ${msg}`, err ? err.message : '');
}

function initModels() {
    if (Track) return;
    Track = mongoose.models.Track || mongoose.model('Track', TrackSchema);
}

async function connectDB() {
    if (!MONGODB_URI) {
        throw new Error('MONGODB_URI environment variable is required in non-shadow mode');
    }
    if (mongoose.connection.readyState === 1) return;
    await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 10_000 });
    log('Connected to MongoDB');
}

function normalizeGenreToken(value) {
    if (typeof value !== 'string') return null;

    const trimmed = value.trim().toLowerCase();
    if (!trimmed) return null;

    const slug = trimmed
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/&/g, ' and ')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

    return slug || null;
}

function normalizeGenres(input) {
    const source = Array.isArray(input) ? input : [input];
    const deduped = [];
    const seen = new Set();

    for (const item of source) {
        const normalized = normalizeGenreToken(item);
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        deduped.push(normalized);
        if (deduped.length >= 5) break;
    }

    return deduped;
}

function normalizeMetadataPayload(payload) {
    if (!payload || typeof payload !== 'object') return {};

    const normalized = {};

    if (Object.prototype.hasOwnProperty.call(payload, 'album')) {
        const album = typeof payload.album === 'string' ? payload.album.trim() : '';
        if (album) normalized.album = album;
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'albumImage')) {
        const albumImage = typeof payload.albumImage === 'string' ? payload.albumImage.trim() : '';
        if (albumImage) normalized.albumImage = albumImage;
    }

    const hasGenres = Object.prototype.hasOwnProperty.call(payload, 'genres');
    const hasPrimaryGenre = Object.prototype.hasOwnProperty.call(payload, 'primaryGenre');

    if (hasGenres) {
        const genres = normalizeGenres(payload.genres);
        if (genres.length) normalized.genres = genres;
    }

    if (hasPrimaryGenre) {
        const primaryGenre = normalizeGenreToken(payload.primaryGenre);
        if (primaryGenre) normalized.primaryGenre = primaryGenre;
    }

    if (normalized.genres?.length && !normalized.primaryGenre) {
        normalized.primaryGenre = normalized.genres[0];
    }
    if (normalized.primaryGenre && !normalized.genres?.length) {
        normalized.genres = [normalized.primaryGenre];
    } else if (
        normalized.primaryGenre &&
        normalized.genres &&
        !normalized.genres.includes(normalized.primaryGenre) &&
        normalized.genres.length < 5
    ) {
        normalized.genres = [normalized.primaryGenre, ...normalized.genres].slice(0, 5);
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'genreConfidence')) {
        const rawConfidence = Number(payload.genreConfidence);
        if (Number.isFinite(rawConfidence)) {
            normalized.genreConfidence = Math.max(0, Math.min(1, rawConfidence));
        }
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'metadataFingerprint')) {
        const metadataFingerprint =
            typeof payload.metadataFingerprint === 'string'
                ? payload.metadataFingerprint.trim()
                : '';
        if (metadataFingerprint) normalized.metadataFingerprint = metadataFingerprint;
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'metadataSources')) {
        const metadataSources = payload.metadataSources;
        if (metadataSources && typeof metadataSources === 'object') {
            const nextSources = {};
            if (typeof metadataSources.genre === 'string' && metadataSources.genre.trim()) {
                nextSources.genre = metadataSources.genre.trim();
            }
            if (typeof metadataSources.album === 'string' && metadataSources.album.trim()) {
                nextSources.album = metadataSources.album.trim();
            }
            if (Object.keys(nextSources).length) {
                normalized.metadataSources = nextSources;
            }
        }
    }

    return normalized;
}

function pickFirstDefined(...values) {
    for (const value of values) {
        if (value !== undefined) return value;
    }
    return undefined;
}

function extractComputedMetadata(parsed) {
    const computed =
        parsed?.computedMetadata ??
        parsed?.metadata ??
        parsed?.enrichedMetadata ??
        parsed?.enrichment ??
        parsed?.computed ??
        {};

    return {
        album: pickFirstDefined(computed.album, parsed?.album),
        albumImage: pickFirstDefined(computed.albumImage, parsed?.albumImage),
        genres: pickFirstDefined(computed.genres, parsed?.genres),
        primaryGenre: pickFirstDefined(computed.primaryGenre, parsed?.primaryGenre),
        genreConfidence: pickFirstDefined(computed.genreConfidence, parsed?.genreConfidence),
        metadataFingerprint: pickFirstDefined(computed.metadataFingerprint, parsed?.metadataFingerprint),
        metadataSources: pickFirstDefined(computed.metadataSources, parsed?.metadataSources),
    };
}

function buildMissingStringExpr(field) {
    const fieldPath = `$${field}`;
    return {
        $let: {
            vars: { fieldType: { $type: fieldPath } },
            in: {
                $cond: [
                    { $eq: ['$$fieldType', 'string'] },
                    {
                        $or: [
                            { $eq: [{ $trim: { input: fieldPath } }, ''] },
                            { $eq: [fieldPath, 'Unknown Album'] },
                        ],
                    },
                    true,
                ],
            },
        },
    };
}

function buildMissingArrayExpr(field) {
    const fieldPath = `$${field}`;
    return {
        $let: {
            vars: { fieldType: { $type: fieldPath } },
            in: {
                $cond: [
                    { $eq: ['$$fieldType', 'array'] },
                    { $eq: [{ $size: fieldPath }, 0] },
                    true,
                ],
            },
        },
    };
}

function buildMissingObjectExpr(field) {
    const fieldPath = `$${field}`;
    return {
        $let: {
            vars: { fieldType: { $type: fieldPath } },
            in: {
                $cond: [
                    { $eq: ['$$fieldType', 'object'] },
                    { $eq: [{ $size: { $objectToArray: fieldPath } }, 0] },
                    true,
                ],
            },
        },
    };
}

function buildMissingGenreConfidenceExpr(field, nextConfidence) {
    const fieldPath = `$${field}`;
    const conditions = [{ $in: [{ $type: fieldPath }, ['missing', 'null']] }];
    if (nextConfidence > 0) {
        conditions.push({ $eq: [fieldPath, 0] });
    }
    return conditions.length === 1 ? conditions[0] : { $or: conditions };
}

function buildTrackQuery(job) {
    const clauses = [];

    if (job.trackId && mongoose.Types.ObjectId.isValid(job.trackId)) {
        clauses.push({ _id: new mongoose.Types.ObjectId(job.trackId) });
    }
    if (job.spotifyId) {
        clauses.push({ spotifyId: job.spotifyId });
    }

    if (clauses.length === 0) return null;
    return clauses.length === 1 ? clauses[0] : { $or: clauses };
}

function parseJob(rawJob) {
    const parsed = JSON.parse(rawJob);
    return {
        raw: parsed,
        trackId: parsed?.trackId ?? null,
        spotifyId: parsed?.spotifyId ?? null,
        name: parsed?.name ?? null,
        artists: Array.isArray(parsed?.artists) ? parsed.artists : [],
        album: parsed?.album ?? null,
        albumImage: parsed?.albumImage ?? null,
        queuedAt: parsed?.queuedAt ?? null,
    };
}

async function applyMetadataUpdate(job) {
    const query = buildTrackQuery(job);
    if (!query) {
        logWarn(`Skipping metadata write: unresolved track query (trackId=${job.trackId || 'n/a'})`);
        return;
    }

    const computedMetadata = normalizeMetadataPayload(extractComputedMetadata(job.raw));
    const setPatch = {
        metadataUpdatedAt: new Date(),
    };
    const conditionalFields = [];

    if (computedMetadata.album) {
        setPatch.album = {
            $cond: [
                buildMissingStringExpr('album'),
                { $literal: computedMetadata.album },
                '$album',
            ],
        };
        conditionalFields.push('album');
    }
    if (computedMetadata.albumImage) {
        setPatch.albumImage = {
            $cond: [
                buildMissingStringExpr('albumImage'),
                { $literal: computedMetadata.albumImage },
                '$albumImage',
            ],
        };
        conditionalFields.push('albumImage');
    }
    if (computedMetadata.genres?.length) {
        setPatch.genres = {
            $cond: [
                buildMissingArrayExpr('genres'),
                { $literal: computedMetadata.genres },
                '$genres',
            ],
        };
        conditionalFields.push('genres');
    }
    if (computedMetadata.primaryGenre) {
        setPatch.primaryGenre = {
            $cond: [
                buildMissingStringExpr('primaryGenre'),
                { $literal: computedMetadata.primaryGenre },
                '$primaryGenre',
            ],
        };
        conditionalFields.push('primaryGenre');
    }
    if (typeof computedMetadata.genreConfidence === 'number') {
        setPatch.genreConfidence = {
            $cond: [
                buildMissingGenreConfidenceExpr('genreConfidence', computedMetadata.genreConfidence),
                { $literal: computedMetadata.genreConfidence },
                '$genreConfidence',
            ],
        };
        conditionalFields.push('genreConfidence');
    }
    if (computedMetadata.metadataFingerprint) {
        setPatch.metadataFingerprint = {
            $cond: [
                buildMissingStringExpr('metadataFingerprint'),
                { $literal: computedMetadata.metadataFingerprint },
                '$metadataFingerprint',
            ],
        };
        conditionalFields.push('metadataFingerprint');
    }
    if (computedMetadata.metadataSources) {
        setPatch.metadataSources = {
            $cond: [
                buildMissingObjectExpr('metadataSources'),
                { $literal: computedMetadata.metadataSources },
                '$metadataSources',
            ],
        };
        conditionalFields.push('metadataSources');
    }

    const result = await Track.updateOne(query, [
        { $set: setPatch },
        {
            $set: {
                metadataAttempts: {
                    $add: [{ $ifNull: ['$metadataAttempts', 0] }, 1],
                },
            },
        },
    ]);

    if (result.matchedCount === 0) {
        logWarn(
            `Skipping metadata write: track not found (` +
            `trackId=${job.trackId || 'n/a'}, spotifyId=${job.spotifyId || 'n/a'})`
        );
        return;
    }

    if (conditionalFields.length) {
        log(
            `Applied atomic metadata update (${conditionalFields.join(', ')}) for ` +
            `${job.trackId || job.spotifyId}`
        );
    } else {
        log(`No computed metadata fields to patch for ${job.trackId || job.spotifyId}; attempts incremented`);
    }
}

async function processJob(rawJob) {
    const job = parseJob(rawJob);
    const identity = job.trackId || job.spotifyId || 'unknown';

    if (!job.trackId && !job.spotifyId) {
        logWarn(`Skipping job without track identity (${rawJob.slice(0, 120)})`);
        return;
    }

    if (SHADOW_MODE) {
        log(
            `Shadow mode: metadata enrichment skipped for ${identity} ` +
            `(name="${job.name || 'unknown'}")`
        );
        return;
    }

    await applyMetadataUpdate(job);
}

async function main() {
    if (!SHADOW_MODE) {
        initModels();
        await connectDB();

        mongoose.connection.on('error', (err) => logError('MongoDB connection error', err));
        mongoose.connection.on('disconnected', () => logWarn('MongoDB disconnected — reconnect handled by driver'));
    }

    const redis = new Redis(REDIS_URL, {
        retryStrategy(times) {
            const delay = Math.min(times * 500, 30_000);
            logWarn(`Redis disconnected — retry #${times} in ${delay}ms`);
            return delay;
        },
        lazyConnect: false,
        enableOfflineQueue: false,
    });

    let redisReady = false;
    redis.on('connect', () => { redisReady = true; log('Connected to Redis'); });
    redis.on('ready', () => { redisReady = true; });
    redis.on('close', () => { redisReady = false; logWarn('Redis connection closed'); });
    redis.on('error', (err) => logError('Redis error', err));

    log(`Watching queue: ${QUEUE_KEY}`);
    log(`Shadow mode: ${SHADOW_MODE ? 'enabled' : 'disabled'}`);

    // eslint-disable-next-line no-constant-condition
    while (true) {
        try {
            if (!redisReady) {
                await new Promise((resolve) => setTimeout(resolve, 2000));
                continue;
            }

            const result = await redis.blpop(QUEUE_KEY, BLPOP_TIMEOUT_SECONDS);
            if (!result) continue;

            const rawJob = result[1];
            await processJob(rawJob);
        } catch (err) {
            logError('Failed to process metadata queue item', err);
        }

        await new Promise((resolve) => setTimeout(resolve, JOB_DELAY_MS));
    }
}

main().catch((err) => {
    console.error('[metadataWorker] Fatal startup error:', err);
    process.exit(1);
});
