import fs from 'node:fs';

const queueHelperPath = 'lib/metadataQueue.js';

if (!fs.existsSync(queueHelperPath)) {
    console.error(`Queue contract failed: missing ${queueHelperPath}`);
    process.exit(1);
}

const src = fs.readFileSync(queueHelperPath, 'utf8');
const batchMatch = src.match(
    /export\s+async\s+function\s+enqueueMetadataBatch\s*\(\s*tracks\s*,\s*context\s*\)\s*\{[\s\S]*?\n\}/
);
const batchSrc = batchMatch?.[0] ?? '';

const checks = [
    [
        'getRedis import',
        /import\s+\{\s*getRedis\s*\}\s+from\s+['"]@\/lib\/redis['"]/.test(src),
    ],
    [
        'METADATA_QUEUE_KEY export',
        /export\s+const\s+METADATA_QUEUE_KEY\s*=\s*['"]demus:metadata:queue['"]/.test(src),
    ],
    [
        'enqueueMetadataJob export',
        /export\s+async\s+function\s+enqueueMetadataJob\s*\(\s*job\s*\)/.test(src),
    ],
    [
        'enqueueMetadataBatch export',
        /export\s+async\s+function\s+enqueueMetadataBatch\s*\(\s*tracks\s*,\s*context\s*\)/.test(src),
    ],
    [
        'payload includes albumImage',
        /albumImage\s*:\s*track\?\.albumImage\s*\?\?\s*null/.test(src),
    ],
    [
        'payload includes queuedAt',
        /queuedAt\s*:\s*context\?\.queuedAt\s*\?\?\s*new\s+Date\(\)\.toISOString\(\)/.test(src),
    ],
    [
        'payload spreads context at top-level',
        /\.\.\.\s*\(\s*context\s*\?\?\s*\{\s*\}\s*\)/.test(src),
    ],
    [
        'payload does not nest context object',
        !/\bcontext\s*,/.test(src),
    ],
    [
        'batch resolves Redis once',
        /const\s+redis\s*=\s*await\s+getRedis\(\)/.test(batchSrc),
    ],
    [
        'batch avoids per-item enqueueMetadataJob calls',
        !/enqueueMetadataJob\s*\(/.test(batchSrc),
    ],
];

const failed = checks.filter(([, ok]) => !ok).map(([name]) => name);
if (failed.length) {
    console.error('Queue contract failed:', failed.join(', '));
    process.exit(1);
}

console.log('Queue contract passed');
