import { requireAdmin } from '@/lib/requireAdmin';
import { connectDB } from '@/lib/mongodb';
import ArtistExpandBlock from '@/models/ArtistExpandBlock';
import ArtistJob from '@/models/ArtistJob';
import { normalizeArtistName, resolveArtistTarget } from '@/lib/admin/resolveArtistTarget';

function normalizeArtistKey(value) {
    const normalized = normalizeArtistName(value);
    return normalized ? normalized.toLowerCase() : null;
}

function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function resolveArtistIdentity(input) {
    const requestedSpotifyId = typeof input?.spotifyId === 'string' ? input.spotifyId.trim() : '';
    const requestedName = normalizeArtistName(input?.name);

    let resolvedTarget = null;
    if (requestedSpotifyId) {
        resolvedTarget = await resolveArtistTarget({
            spotifyId: requestedSpotifyId,
            artistName: requestedName,
        });
    }

    const artistSpotifyId = resolvedTarget?.artistSpotifyId || null;
    const artistName = normalizeArtistName(resolvedTarget?.artistName) || requestedName;
    const normalizedArtistName = normalizeArtistKey(artistName);

    if (!artistSpotifyId && !normalizedArtistName) {
        return null;
    }

    return {
        artistSpotifyId,
        artistName: artistName || null,
        normalizedArtistName,
    };
}

async function blockArtists(artists) {
    const results = [];

    for (const artist of artists) {
        const identity = await resolveArtistIdentity(artist);
        if (!identity) {
            results.push({
                artistSpotifyId: null,
                artistName: null,
                status: 'failed',
                reason: 'missing_artist_identifier',
            });
            continue;
        }

        if (!identity.normalizedArtistName) {
            results.push({
                artistSpotifyId: identity.artistSpotifyId,
                artistName: identity.artistName,
                status: 'failed',
                reason: 'missing_artist_name',
            });
            continue;
        }

        await ArtistExpandBlock.findOneAndUpdate(
            { normalizedArtistName: identity.normalizedArtistName },
            {
                $set: {
                    artistName: identity.artistName,
                    normalizedArtistName: identity.normalizedArtistName,
                    artistSpotifyId: identity.artistSpotifyId,
                },
            },
            { upsert: true, returnDocument: 'after' }
        );

        const queuedFilter = [{ status: 'queued', artistName: { $regex: `^${escapeRegex(identity.artistName)}$`, $options: 'i' } }];
        if (identity.artistSpotifyId) {
            queuedFilter.push({ status: 'queued', artistSpotifyId: identity.artistSpotifyId });
        }

        await ArtistJob.updateMany(
            { $or: queuedFilter },
            {
                $set: {
                    status: 'failed',
                    error: 'blocked_do_not_expand',
                    completedAt: new Date(),
                },
            }
        );

        results.push({
            artistSpotifyId: identity.artistSpotifyId,
            artistName: identity.artistName,
            status: 'blocked',
            reason: 'blocked_do_not_expand',
        });
    }

    return results;
}

async function unblockArtists(artists) {
    const results = [];

    for (const artist of artists) {
        const identity = await resolveArtistIdentity(artist);
        if (!identity) {
            results.push({
                artistSpotifyId: null,
                artistName: null,
                status: 'failed',
                reason: 'missing_artist_identifier',
            });
            continue;
        }

        const deleteFilter = [];
        if (identity.normalizedArtistName) {
            deleteFilter.push({ normalizedArtistName: identity.normalizedArtistName });
        }
        if (identity.artistSpotifyId) {
            deleteFilter.push({ artistSpotifyId: identity.artistSpotifyId });
        }

        const removed = deleteFilter.length > 0
            ? await ArtistExpandBlock.findOneAndDelete({ $or: deleteFilter })
            : null;

        results.push({
            artistSpotifyId: identity.artistSpotifyId,
            artistName: identity.artistName,
            status: removed ? 'unblocked' : 'skipped',
            reason: removed ? 'removed_from_blocklist' : 'not_in_blocklist',
        });
    }

    return results;
}

async function handler(req, res) {
    if (!['POST', 'DELETE', 'GET'].includes(req.method)) {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    await connectDB();

    if (req.method === 'GET') {
        const items = await ArtistExpandBlock.find({})
            .select({ artistName: 1, artistSpotifyId: 1, updatedAt: 1, createdAt: 1 })
            .sort({ updatedAt: -1, _id: -1 })
            .lean();
        return res.status(200).json({ items });
    }

    const { artists } = req.body || {};
    if (!Array.isArray(artists) || artists.length === 0) {
        return res.status(400).json({ error: 'artists must be a non-empty array' });
    }

    const results = req.method === 'POST'
        ? await blockArtists(artists)
        : await unblockArtists(artists);

    const summary = {
        total: results.length,
        blocked: results.filter((item) => item.status === 'blocked').length,
        unblocked: results.filter((item) => item.status === 'unblocked').length,
        skipped: results.filter((item) => item.status === 'skipped').length,
        failed: results.filter((item) => item.status === 'failed').length,
    };

    return res.status(200).json({ summary, results });
}

export default requireAdmin(handler);
