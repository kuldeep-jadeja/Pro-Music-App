'use strict';

const fs = require('fs');
const path = require('path');
const Redis = require('ioredis');

(function loadEnvLocal() {
    if (process.env.REDIS_URL || process.env.METADATA_WORKER_SHADOW_MODE) return;
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
const QUEUE_KEY = 'demus:metadata:queue';
const BLPOP_TIMEOUT_SECONDS = 5;
const JOB_DELAY_MS = 500;
const isDev = process.env.NODE_ENV !== 'production';

const SHADOW_MODE_VALUES = new Set(['1', 'true', 'yes', 'on']);
const SHADOW_MODE = SHADOW_MODE_VALUES.has(
    String(process.env.METADATA_WORKER_SHADOW_MODE || 'true').toLowerCase()
);

function log(msg) {
    if (isDev) console.log(`[metadataWorker] ${msg}`);
}

function logWarn(msg) {
    console.warn(`[metadataWorker] WARN ${msg}`);
}

function logError(msg, err) {
    console.error(`[metadataWorker] ERROR ${msg}`, err ? err.message : '');
}

function parseJob(rawJob) {
    const parsed = JSON.parse(rawJob);
    return {
        trackId: parsed?.trackId ?? null,
        spotifyId: parsed?.spotifyId ?? null,
        name: parsed?.name ?? null,
        artists: Array.isArray(parsed?.artists) ? parsed.artists : [],
        album: parsed?.album ?? null,
        queuedAt: parsed?.queuedAt ?? null,
    };
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

    logWarn(
        `Provider pipeline not implemented yet; acknowledged metadata job for ${identity}`
    );
}

async function main() {
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
