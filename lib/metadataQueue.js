import { getRedis } from '@/lib/redis';

export const METADATA_QUEUE_KEY = 'demus:metadata:queue';

const isDev = process.env.NODE_ENV !== 'production';

function toMetadataJob(track, context = {}) {
    const trackId =
        track?.trackId ??
        track?._id?.toString?.() ??
        track?._id ??
        track?.id ??
        null;

    return {
        trackId,
        spotifyId: track?.spotifyId ?? null,
        name: track?.name ?? null,
        artists: Array.isArray(track?.artists) ? track.artists : [],
        album: track?.album ?? null,
        albumImage: track?.albumImage ?? null,
        queuedAt: context?.queuedAt ?? new Date().toISOString(),
        ...(context ?? {}),
    };
}

export async function enqueueMetadataJob(job) {
    try {
        const redis = await getRedis();

        if (!redis) {
            if (isDev) {
                console.warn('[MetadataQueue] Redis unavailable — skipping enqueue');
            }
            return false;
        }

        await redis.rpush(METADATA_QUEUE_KEY, JSON.stringify(job));

        if (isDev) {
            console.log(
                `[MetadataQueue] Queued metadata job (trackId=${job?.trackId ?? 'unknown'})`
            );
        }

        return true;
    } catch (err) {
        console.error('[MetadataQueue] Failed to enqueue job:', err.message);
        return false;
    }
}

export async function enqueueMetadataBatch(tracks, context) {
    if (!Array.isArray(tracks) || tracks.length === 0) {
        return { total: 0, queued: 0, failed: 0 };
    }

    const jobs = tracks.map((track) => toMetadataJob(track, context ?? {}));

    try {
        const redis = await getRedis();

        if (!redis) {
            if (isDev) {
                console.warn('[MetadataQueue] Redis unavailable — skipping batch enqueue');
            }
            return { total: tracks.length, queued: 0, failed: tracks.length };
        }

        await redis.rpush(
            METADATA_QUEUE_KEY,
            ...jobs.map((job) => JSON.stringify(job))
        );

        if (isDev) {
            console.log(`[MetadataQueue] Queued ${jobs.length} metadata jobs`);
        }
    } catch (err) {
        console.error('[MetadataQueue] Failed to enqueue metadata batch:', err.message);
        return { total: tracks.length, queued: 0, failed: tracks.length };
    }

    return {
        total: tracks.length,
        queued: tracks.length,
        failed: 0,
    };
}
