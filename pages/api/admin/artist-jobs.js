import { requireAdmin } from '@/lib/requireAdmin';
import { connectDB } from '@/lib/mongodb';
import ArtistJob from '@/models/ArtistJob';
import ArtistExpandBlock from '@/models/ArtistExpandBlock';
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

function normalizeArtistKey(value) {
    const normalized = normalizeArtistName(value);
    return normalized ? normalized.toLowerCase() : null;
}

function compareByUpdatedThenIdDesc(a, b) {
    const aTime = a?.updatedAt ? new Date(a.updatedAt).getTime() : 0;
    const bTime = b?.updatedAt ? new Date(b.updatedAt).getTime() : 0;
    if (aTime !== bTime) return bTime - aTime;
    return String(b?._id || '').localeCompare(String(a?._id || ''));
}

async function listArtistCandidates(limit) {
    const docs = await Track.aggregate([
        {
            $match: {
                spotifyId: { $exists: true, $type: 'string', $ne: '' },
                artists: { $exists: true, $type: 'array', $ne: [] },
            },
        },
        {
            $project: {
                seedSpotifyId: '$spotifyId',
                updatedAt: '$updatedAt',
                primaryArtistRaw: { $arrayElemAt: ['$artists', 0] },
            },
        },
        {
            $addFields: {
                artistName: { $trim: { input: { $ifNull: ['$primaryArtistRaw', ''] } } },
            },
        },
        { $match: { artistName: { $ne: '' } } },
        { $sort: { updatedAt: -1, _id: -1 } },
        {
            $group: {
                _id: { $toLower: '$artistName' },
                artistName: { $first: '$artistName' },
                queueSpotifyId: { $first: '$seedSpotifyId' },
                updatedAt: { $first: '$updatedAt' },
                trackCount: { $sum: 1 },
            },
        },
        { $sort: { updatedAt: -1, artistName: 1 } },
        { $limit: Math.max(1, limit) },
    ]);

    return docs.map((doc) => ({
        _id: `candidate:${doc._id}`,
        artistName: doc.artistName || null,
        artistSpotifyId: null,
        queueSpotifyId: doc.queueSpotifyId || null,
        status: 'not_queued',
        error: null,
        updatedAt: doc.updatedAt || null,
        queuedAt: null,
        startedAt: null,
        completedAt: null,
        retriedAt: null,
        isCandidate: true,
        trackCount: doc.trackCount || 0,
    }));
}

async function listBlockedArtists({ q, limit, skip }) {
    const filter = {};
    if (q) {
        const escaped = escapeRegex(q);
        filter.$or = [
            { artistName: { $regex: escaped, $options: 'i' } },
            { artistSpotifyId: { $regex: escaped, $options: 'i' } },
        ];
    }

    const total = await ArtistExpandBlock.countDocuments(filter);
    const docs = await ArtistExpandBlock.find(filter)
        .select({
            artistName: 1,
            artistSpotifyId: 1,
            updatedAt: 1,
            createdAt: 1,
        })
        .sort({ updatedAt: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .lean();

    const items = docs.map((doc) => ({
        _id: `blocked:${doc._id}`,
        artistName: doc.artistName || null,
        artistSpotifyId: doc.artistSpotifyId || null,
        queueSpotifyId: doc.artistSpotifyId || null,
        status: 'not_queued',
        error: null,
        updatedAt: doc.updatedAt || doc.createdAt || null,
        queuedAt: null,
        startedAt: null,
        completedAt: null,
        retriedAt: null,
        isCandidate: true,
        isBlocked: true,
        blockedAt: doc.updatedAt || doc.createdAt || null,
    }));

    return { items, total };
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

async function annotateBlockedState(items) {
    if (!Array.isArray(items) || items.length === 0) return;

    const normalizedNames = [...new Set(
        items
            .map((item) => normalizeArtistKey(item.artistName))
            .filter(Boolean)
    )];
    const spotifyIds = [...new Set(
        items
            .map((item) => (typeof item.artistSpotifyId === 'string' ? item.artistSpotifyId.trim() : ''))
            .filter(Boolean)
    )];

    const blockFilter = [];
    if (normalizedNames.length > 0) {
        blockFilter.push({ normalizedArtistName: { $in: normalizedNames } });
    }
    if (spotifyIds.length > 0) {
        blockFilter.push({ artistSpotifyId: { $in: spotifyIds } });
    }
    if (blockFilter.length === 0) {
        for (const item of items) item.isBlocked = false;
        return;
    }

    const blockedItems = await ArtistExpandBlock.find({ $or: blockFilter })
        .select({ normalizedArtistName: 1, artistSpotifyId: 1, updatedAt: 1 })
        .lean();

    const blockedNameMap = new Map(
        blockedItems
            .filter((item) => item.normalizedArtistName)
            .map((item) => [item.normalizedArtistName, item])
    );
    const blockedSpotifyMap = new Map(
        blockedItems
            .filter((item) => item.artistSpotifyId)
            .map((item) => [item.artistSpotifyId, item])
    );

    for (const item of items) {
        const byName = blockedNameMap.get(normalizeArtistKey(item.artistName));
        const bySpotifyId = item.artistSpotifyId
            ? blockedSpotifyMap.get(String(item.artistSpotifyId).trim())
            : null;
        const blockDoc = byName || bySpotifyId || null;
        item.isBlocked = Boolean(blockDoc);
        item.blockedAt = blockDoc?.updatedAt || null;
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

    if (status !== DEFAULT_STATUS_FILTER && status !== 'do_not_expand') {
        filter.status = status;
    }

    if (q) {
        const escaped = escapeRegex(q);
        filter.$or = [
            { artistName: { $regex: escaped, $options: 'i' } },
            { artistSpotifyId: { $regex: escaped, $options: 'i' } },
        ];
    }

    const skip = (page - 1) * limit;
    const escapedQuery = q ? new RegExp(escapeRegex(q), 'i') : null;

    if (status === 'do_not_expand') {
        const blocked = await listBlockedArtists({ q, limit, skip });
        return res.status(200).json({
            items: blocked.items,
            pagination: {
                page,
                limit,
                total: blocked.total,
                totalPages: blocked.total > 0 ? Math.ceil(blocked.total / limit) : 0,
            },
            filters: {
                status,
                q,
            },
        });
    }

    const jobItems = await ArtistJob.find(filter)
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

    await backfillMissingArtistNames(jobItems);

    const normalizedJobItems = jobItems.map((item) => ({
        ...item,
        queueSpotifyId: item.artistSpotifyId || null,
        isCandidate: false,
    }));

    let items = [...normalizedJobItems];
    if (status === DEFAULT_STATUS_FILTER && page === 1) {
        const candidatePool = await listArtistCandidates(limit * 4);
        const existingArtistNames = new Set(
            normalizedJobItems
                .map((item) => normalizeArtistName(item.artistName))
                .filter(Boolean)
                .map((name) => name.toLowerCase())
        );

        const candidateItems = [];
        for (const candidate of candidatePool) {
            const normalizedName = normalizeArtistName(candidate.artistName);
            if (!normalizedName) continue;
            if (existingArtistNames.has(normalizedName.toLowerCase())) continue;

            if (
                escapedQuery &&
                !escapedQuery.test(candidate.artistName || '') &&
                !escapedQuery.test(candidate.queueSpotifyId || '')
            ) {
                continue;
            }

            candidateItems.push(candidate);
            if ((normalizedJobItems.length + candidateItems.length) >= limit) break;
        }

        items = [...normalizedJobItems, ...candidateItems]
            .sort(compareByUpdatedThenIdDesc)
            .slice(0, limit);
    }

    await annotateBlockedState(items);

    return res.status(200).json({
        items,
        pagination: {
            page,
            limit,
            total: items.length,
            totalPages: items.length > 0 ? 1 : 0,
        },
        filters: {
            status,
            q,
        },
    });
}

export default requireAdmin(handler);
