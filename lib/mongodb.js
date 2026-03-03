import mongoose from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
    throw new Error('Please define MONGODB_URI in .env.local');
}

/**
 * Global cache to prevent multiple connections in dev (hot reload).
 */
let cached = global.mongoose;

if (!cached) {
    cached = global.mongoose = { conn: null, promise: null };
}

// ---------------------------------------------------------------------------
// ONE-TIME STARTUP RECOVERY — Critical fix for orphaned "matching" playlists
// ---------------------------------------------------------------------------
// If the Node process crashes or restarts while batchMatchTracks is running,
// affected playlists remain stuck in status 'matching' forever.  On the first
// successful DB connection per process lifetime, we sweep for any playlists
// that have been in 'matching' for more than 5 minutes and flip them to
// 'paused' so users can resume them.
//
// The flag lives on `global` so it survives Next.js hot reloads in dev.
// ---------------------------------------------------------------------------
let recoveryRan = global.__matchingRecoveryRan || false;

/**
 * Run a one-time recovery sweep for playlists stuck in 'matching' status.
 * Safe to call multiple times — the global flag ensures it executes only once.
 * Wrapped in try/catch so it NEVER blocks server startup or crashes the app.
 */
async function recoverStuckPlaylists() {
    if (recoveryRan) return;
    recoveryRan = true;
    global.__matchingRecoveryRan = true;

    try {
        // Dynamic import to avoid circular dependency at module load time.
        // Playlist model may import from libs that import mongodb.js.
        const { default: Playlist } = await import('@/models/Playlist');

        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

        const result = await Playlist.updateMany(
            {
                status: 'matching',
                updatedAt: { $lt: fiveMinutesAgo },
            },
            {
                $set: {
                    status: 'paused',
                    pausedAt: new Date(),
                    errorMessage: 'Server restarted during matching — click Resume to continue',
                },
            }
        );

        if (result.modifiedCount > 0) {
            console.log(
                `[Recovery] Marked ${result.modifiedCount} stuck playlist(s) as paused`
            );
        }
    } catch (err) {
        // Non-fatal — log and move on.  Server must not crash on recovery failure.
        console.error('[Recovery] Failed to recover stuck playlists:', err.message);
    }
}

export async function connectDB() {
    if (cached.conn) return cached.conn;

    if (!cached.promise) {
        cached.promise = mongoose.connect(MONGODB_URI, {
            bufferCommands: false,
        }).then((mongoose) => {
            console.log('MongoDB connected');
            return mongoose;
        }).catch((err) => {
            console.error('MongoDB connection error:', err.message);
            throw err;
        });
    }

    try {
        cached.conn = await cached.promise;
    } catch (err) {
        cached.promise = null;
        throw err;
    }

    // Run recovery sweep once after the first successful connection.
    // This is fire-and-forget — it does NOT block the return of the connection.
    recoverStuckPlaylists();

    return cached.conn;
}
