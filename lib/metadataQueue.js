import { getRedis } from '@/lib/redis';

export const METADATA_QUEUE_KEY = 'demus:metadata:queue';

const isDev = process.env.NODE_ENV !== 'production';

function toMetadataJob(track, context) {
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
        context,
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

    let queued = 0;
    let failed = 0;

    for (const track of tracks) {
        const job = toMetadataJob(track, context ?? {});
        const ok = await enqueueMetadataJob(job);
        if (ok) {
            queued += 1;
        } else {
            failed += 1;
        }
    }

    return {
        total: tracks.length,
        queued,
        failed,
    };
}
