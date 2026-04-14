/**
 * testQueue.js — End-to-end test for the Redis YouTube match queue.
 *
 * Run with:  node scripts/testQueue.js
 *
 * Steps:
 *   1. Connect to MongoDB + Redis using .env.local credentials
 *   2. Find (or create) a real Track document that has no youtubeVideoId
 *   3. Push a job onto demus:ytmatch:queue
 *   4. Start the worker inline (same process) for 30 seconds
 *   5. Poll MongoDB every 2 s to see if the youtubeVideoId was written
 *   6. Report pass/fail and clean up
 */

'use strict';

const fs = require('fs');
const path = require('path');
const Redis = require('ioredis');
const mongoose = require('mongoose');

// ── Load .env.local ──────────────────────────────────────────────────────────
(function loadEnvLocal() {
    const envPath = path.resolve(__dirname, '..', '.env.local');
    if (!fs.existsSync(envPath)) { console.error('Missing .env.local'); process.exit(1); }
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
const QUEUE_KEY = 'demus:ytmatch:queue';
const TIMEOUT_S = 40;   // wait up to 40 s for the worker (running separately)

if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }

// ── Minimal schemas (test-only) ──────────────────────────────────────────────
const TrackSchema = new mongoose.Schema({
    name: String, artists: [String], album: String, duration: Number,
    spotifyId: String, youtubeVideoId: { type: String, default: null },
    albumImage: String, fingerprint: String, importedAt: Date,
}, { timestamps: true });

async function main() {
    console.log('\n=== Demus Redis Queue — End-to-End Test ===\n');

    // 1. Connect
    console.log('1. Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 10_000 });
    console.log('   ✓ MongoDB connected');

    console.log('2. Connecting to Redis...');
    const redis = new Redis(REDIS_URL, { lazyConnect: false });
    await new Promise((res, rej) => {
        redis.once('ready', res);
        redis.once('error', rej);
    });
    console.log('   ✓ Redis connected');

    const Track = mongoose.models.Track || mongoose.model('Track', TrackSchema);

    // 2. Find a track without a YouTube video id (or use a synthetic test doc)
    let track = await Track.findOne({
        $or: [{ youtubeVideoId: null }, { youtubeVideoId: { $exists: false } }],
    }).lean();

    let testDocCreated = false;
    if (!track) {
        console.log('   No unmatched track found — creating a synthetic test track...');
        track = await Track.create({
            name: 'Blinding Lights',
            artists: ['The Weeknd'],
            album: 'After Hours',
            duration: 200040,
            spotifyId: `__test__${Date.now()}`,
            youtubeVideoId: null,
            importedAt: new Date(),
        });
        testDocCreated = true;
        console.log(`   ✓ Test track created (id=${track._id})`);
    } else {
        console.log(`   ✓ Using existing unmatched track: "${track.name}" (id=${track._id})`);
    }

    // 3. Push job onto queue
    const job = {
        trackId: track._id.toString(),
        playlistId: null,   // no playlist — worker skips progress update gracefully
        name: track.name,
        artist: (track.artists && track.artists[0]) || 'Unknown',
        duration: track.duration,
    };

    const queueLenBefore = await redis.llen(QUEUE_KEY);
    await redis.rpush(QUEUE_KEY, JSON.stringify(job));
    const queueLenAfter = await redis.llen(QUEUE_KEY);

    console.log(`\n3. Job enqueued onto ${QUEUE_KEY}`);
    console.log(`   Queue depth: ${queueLenBefore} → ${queueLenAfter}`);
    console.log(`   Payload: ${JSON.stringify(job)}`);

    // 4. Poll MongoDB for the youtubeVideoId
    console.log(`\n4. Waiting up to ${TIMEOUT_S}s for the worker to process the job...`);
    console.log('   (Make sure "npm run ytmatch:worker" is running in another terminal)\n');

    const start = Date.now();
    let videoId = null;

    while (Date.now() - start < TIMEOUT_S * 1000) {
        await new Promise((r) => setTimeout(r, 2000));
        const fresh = await Track.findById(track._id).select('youtubeVideoId').lean();
        if (fresh?.youtubeVideoId) {
            videoId = fresh.youtubeVideoId;
            break;
        }
        const elapsed = Math.round((Date.now() - start) / 1000);
        process.stdout.write(`   [${elapsed}s] still waiting...\r`);
    }

    console.log(''); // newline after \r

    // 5. Report
    if (videoId) {
        console.log(`\n✅ PASS — Track matched!`);
        console.log(`   Track: "${track.name}" by ${track.artists?.[0]}`);
        console.log(`   YouTube Video ID: ${videoId}`);
        console.log(`   YouTube URL: https://www.youtube.com/watch?v=${videoId}`);
    } else {
        console.log(`\n❌ FAIL — youtubeVideoId was not written within ${TIMEOUT_S}s`);
        console.log('   Check that the worker is running: npm run ytmatch:worker');

        // Dump remaining queue length for diagnosis
        const remaining = await redis.llen(QUEUE_KEY);
        console.log(`   Jobs still in queue: ${remaining}`);
    }

    // 6. Cleanup test doc
    if (testDocCreated) {
        await Track.deleteOne({ _id: track._id });
        console.log('\n   (Synthetic test track deleted)');
    }

    await redis.quit();
    await mongoose.disconnect();
    console.log('\n=== Test complete ===\n');
    process.exit(videoId ? 0 : 1);
}

main().catch((e) => {
    console.error('\nFATAL:', e.message);
    process.exit(1);
});
