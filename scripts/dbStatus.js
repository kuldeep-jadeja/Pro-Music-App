'use strict';
const fs = require('fs'), path = require('path'), mongoose = require('mongoose');
(function loadEnvLocal() {
    if (process.env.MONGODB_URI) return;
    const raw = fs.readFileSync(path.resolve(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/);
    for (const line of raw) {
        const t = line.trim();
        if (!t || t.startsWith('#')) continue;
        const eq = t.indexOf('=');
        if (eq === -1) continue;
        const k = t.slice(0, eq).trim(), v = t.slice(eq + 1).trim();
        if (!process.env[k]) process.env[k] = v;
    }
}());
const S = new mongoose.Schema({
    name: String, artists: [String], album: String, albumImage: String,
    spotifyId: { type: String, unique: true }, youtubeVideoId: { type: String, default: null }, duration: Number
}, { timestamps: true });
mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 }).then(async () => {
    const T = mongoose.model('Track', S);
    const total = await T.countDocuments();
    const noAlbum = await T.countDocuments({ $or: [{ album: null }, { album: '' }, { album: 'Unknown Album' }] });
    const noImage = await T.countDocuments({ $or: [{ albumImage: null }, { albumImage: { $exists: false } }, { albumImage: '' }] });
    const noYT = await T.countDocuments({ $or: [{ youtubeVideoId: null }, { youtubeVideoId: { $exists: false } }] });
    const noArtist = await T.countDocuments({ $or: [{ artists: [] }, { artists: { $exists: false } }] });
    const fullyComplete = await T.countDocuments({
        name: { $exists: true, $ne: null },
        artists: { $not: { $size: 0 } },
        album: { $exists: true, $ne: null, $nin: ['', 'Unknown Album'] },
        albumImage: { $exists: true, $ne: null, $ne: '' },
        youtubeVideoId: { $exists: true, $ne: null },
    });
    console.log('\n╔════════════════════════════════════════════╗');
    console.log('║          FINAL DB STATE                    ║');
    console.log('╠════════════════════════════════════════════╣');
    console.log(`║  Total tracks        : ${String(total).padEnd(18)} ║`);
    console.log(`║  Fully complete      : ${String(fullyComplete).padEnd(18)} ║`);
    console.log('╠════════════════════════════════════════════╣');
    console.log(`║  Missing album name  : ${String(noAlbum).padEnd(18)} ║`);
    console.log(`║  Missing albumImage  : ${String(noImage).padEnd(18)} ║`);
    console.log(`║  Missing youtubeId   : ${String(noYT).padEnd(18)} ║`);
    console.log(`║  Missing artists[]   : ${String(noArtist).padEnd(18)} ║`);
    console.log('╚════════════════════════════════════════════╝\n');
    await mongoose.disconnect();
}).catch(e => { console.error(e.message); process.exit(1); });
