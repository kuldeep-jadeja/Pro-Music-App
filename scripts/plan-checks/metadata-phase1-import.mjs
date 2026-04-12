import fs from 'node:fs';

const importApiPath = 'pages/api/import-playlist.js';

if (!fs.existsSync(importApiPath)) {
    console.error(`Import contract failed: missing ${importApiPath}`);
    process.exit(1);
}

const src = fs.readFileSync(importApiPath, 'utf8');

const checks = [
    [
        'imports enqueueMetadataBatch',
        /import\s+enqueueMetadataBatch\s+from\s+['"]@\/lib\/metadataQueue['"]/.test(src),
    ],
    [
        'metadata enqueue call present',
        /enqueueMetadataBatch\s*\(\s*rawTracks\s*,\s*context\s*\)/.test(src),
    ],
    [
        'metadata enqueue fire-and-forget catch',
        /enqueueMetadataBatch\s*\(\s*rawTracks\s*,\s*context\s*\)\s*\.catch\s*\(/.test(src),
    ],
];

const failed = checks.filter(([, ok]) => !ok).map(([name]) => name);

if (failed.length) {
    console.error('Import contract failed:', failed.join(', '));
    process.exit(1);
}

console.log('Import contract passed');
