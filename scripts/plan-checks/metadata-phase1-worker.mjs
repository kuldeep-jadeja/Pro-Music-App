import fs from 'node:fs';

const workerPath = 'workers/metadataWorker.js';

if (!fs.existsSync(workerPath)) {
    console.error(`Worker contract failed: missing ${workerPath}`);
    process.exit(1);
}

const src = fs.readFileSync(workerPath, 'utf8');

const checks = [
    [
        'queue key demus:metadata:queue',
        /const\s+QUEUE_KEY\s*=\s*['"]demus:metadata:queue['"]/.test(src),
    ],
    [
        'shadow mode env METADATA_WORKER_SHADOW_MODE',
        /process\.env\.METADATA_WORKER_SHADOW_MODE/.test(src),
    ],
    [
        'BLPOP loop',
        /while\s*\(\s*true\s*\)[\s\S]*redis\.blpop\s*\(\s*QUEUE_KEY\s*,\s*[A-Za-z0-9_]+\s*\)/.test(src),
    ],
];

const failed = checks.filter(([, ok]) => !ok).map(([name]) => name);
if (failed.length) {
    console.error('Worker contract failed:', failed.join(', '));
    process.exit(1);
}

console.log('Worker contract passed');
