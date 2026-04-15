import { requireAdmin } from '@/lib/requireAdmin';
import { connectDB } from '@/lib/mongodb';
import ArtistJob from '@/models/ArtistJob';
import Track from '@/models/Track';
import {
    DEFAULT_LIMIT,
    DEFAULT_QUERY,
    DEFAULT_STATUS_FILTER,
    MAX_LIMIT,
    isValidJobStatusFilter,
} from '@/lib/admin/artistJobsContract';
import { normalizeArtistName, resolveArtistTarget } from '@/lib/admin/resolveArtistTarget';

function asSingleValue(value, fallback = '') {
    if (Array.isArray(value)) return value[0] ?? fallback;
    if (value === undefined || value === null) return fallback;
    return String(value);
}

function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function resolveArtistNameFromTrackCollection(artistSpotifyId) {
    try {
        const track = await Track.findOne({ spotifyId: artistSpotifyId })
            .select({ artists: 1 })
            .lean();
        return normalizeArtistName(track?.artists?.[0]);
    } catch (_) {
        return null;
    }
}

async function backfillMissingArtistNames(items) {
    const missingNameItems = items.filter((item) => !normalizeArtistName(item.artistName) && item.artistSpotifyId);
    if (missingNameItems.length === 0) return;

    for (const item of missingNameItems) {
        const resolvedTarget = await resolveArtistTarget({
            spotifyId: item.artistSpotifyId,
            artistName: item.artistName,
        });
        const resolvedName = resolvedTarget?.artistName || await resolveArtistNameFromTrackCollection(item.artistSpotifyId);
        if (!resolvedName) continue;

        item.artistName = resolvedName;
        try {
            await ArtistJob.updateOne(
                { _id: item._id, $or: [{ artistName: null }, { artistName: '' }] },
                { $set: { artistName: resolvedName } }
            );
        } catch (_) { /* non-blocking name backfill */ }
    }
}

async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    await connectDB();

    const status = asSingleValue(req.query.status, DEFAULT_STATUS_FILTER);
    const q = asSingleValue(req.query.q, DEFAULT_QUERY).trim();

    if (!isValidJobStatusFilter(status)) {
        return res.status(400).json({ error: 'invalid_status_filter' });
    }

    const pageParam = Number.parseInt(asSingleValue(req.query.page, '1'), 10);
    const limitParam = Number.parseInt(asSingleValue(req.query.limit, String(DEFAULT_LIMIT)), 10);

    const page = Number.isNaN(pageParam) ? 1 : Math.max(1, pageParam);
    const parsedLimit = Number.isNaN(limitParam) ? DEFAULT_LIMIT : limitParam;
    const limit = Math.max(1, Math.min(MAX_LIMIT, parsedLimit));

    const filter = {};

    if (status !== DEFAULT_STATUS_FILTER) {
        filter.status = status;
    }

    if (q) {
        const escaped = escapeRegex(q);
        filter.$or = [
            { artistName: { $regex: escaped, $options: 'i' } },
            { artistSpotifyId: { $regex: escaped, $options: 'i' } },
        ];
    }

    const total = await ArtistJob.countDocuments(filter);
    const totalPages = total > 0 ? Math.ceil(total / limit) : 0;
    const skip = (page - 1) * limit;

    const items = await ArtistJob.find(filter)
        .select({
            artistName: 1,
            artistSpotifyId: 1,
            status: 1,
            error: 1,
            updatedAt: 1,
            queuedAt: 1,
            startedAt: 1,
            completedAt: 1,
            retriedAt: 1,
        })
        .sort({ updatedAt: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .lean();

    await backfillMissingArtistNames(items);

    return res.status(200).json({
        items,
        pagination: {
            page,
            limit,
            total,
            totalPages,
        },
        filters: {
            status,
            q,
        },
    });
}

export default requireAdmin(handler);
