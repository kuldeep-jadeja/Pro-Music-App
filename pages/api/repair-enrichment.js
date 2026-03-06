import { connectDB } from '@/lib/mongodb';
import { withRateLimit } from '@/lib/rateLimit';
import { requireAuth } from '@/lib/requireAuth';
import { enrichTracksWithMetadata } from '@/lib/spotify';
import Track from '@/models/Track';

/**
 * POST /api/repair-enrichment
 *
 * Finds all tracks in the DB that are missing album name or album art,
 * runs the full 3-tier enrichment pipeline (iTunes → Spotify OG → MusicBrainz),
 * and persists the results back to MongoDB.
 *
 * This is a one-shot repair route for playlists that were imported before
 * background enrichment was wired up.
 */
async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        await connectDB();

        // Find all tracks missing album name or album image
        const incomplete = await Track.find({
            $or: [
                { albumImage: { $in: [null, '', undefined] } },
                { album: { $in: [null, '', 'Unknown Album', undefined] } },
            ],
        })
            .select('spotifyId name artists album albumImage')
            .lean();

        if (incomplete.length === 0) {
            return res.status(200).json({
                success: true,
                message: 'All tracks already have album metadata — nothing to repair.',
                enriched: 0,
            });
        }

        console.log(`[RepairEnrichment] Found ${incomplete.length} track(s) needing enrichment.`);

        // Run the full 3-tier pipeline (mutates objects in-place)
        await enrichTracksWithMetadata(incomplete);

        // Persist only the tracks that were actually resolved
        const resolved = incomplete.filter((t) => t.album || t.albumImage);

        if (resolved.length > 0) {
            const bulkOps = resolved.map((t) => ({
                updateOne: {
                    filter: { spotifyId: t.spotifyId },
                    update: {
                        $set: {
                            ...(t.album ? { album: t.album } : {}),
                            ...(t.albumImage ? { albumImage: t.albumImage } : {}),
                        },
                    },
                },
            }));

            await Track.bulkWrite(bulkOps, { ordered: false });
        }

        const stillMissing = incomplete.length - resolved.length;

        return res.status(200).json({
            success: true,
            total: incomplete.length,
            enriched: resolved.length,
            stillMissing,
            message: `Enriched ${resolved.length} of ${incomplete.length} tracks. ${stillMissing > 0 ? `${stillMissing} track(s) could not be resolved by any source.` : 'All tracks resolved!'}`,
        });
    } catch (err) {
        console.error('[RepairEnrichment] Error:', err.message);
        return res.status(500).json({ error: err.message || 'Repair enrichment failed' });
    }
}

// Rate-limited to 2 calls per minute — this is a heavy background job
export default withRateLimit(requireAuth(handler), 2, 60000);
