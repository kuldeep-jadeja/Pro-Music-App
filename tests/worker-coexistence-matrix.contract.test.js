#!/usr/bin/env node

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const scriptPath = path.join(process.cwd(), 'scripts', 'workerCoexistenceMatrix.js');
if (!fs.existsSync(scriptPath)) {
    throw new Error('Missing scripts/workerCoexistenceMatrix.js');
}

const syntaxCheck = spawnSync('node', ['--check', scriptPath], { encoding: 'utf8' });
if (syntaxCheck.status !== 0) {
    throw new Error(`workerCoexistenceMatrix syntax check failed: ${syntaxCheck.stderr || syntaxCheck.stdout}`);
}

const dryRun = spawnSync(
    'node',
    [scriptPath, '--dry-run', '--base-url', 'http://localhost:4072', '--duration-seconds', '120'],
    { encoding: 'utf8' }
);

if (dryRun.status !== 0) {
    throw new Error(`dry-run failed: ${dryRun.stderr || dryRun.stdout}`);
}

for (const marker of ['baseline', 'overlap', 'recovery']) {
    if (!dryRun.stdout.includes(marker)) {
        throw new Error(`dry-run output missing phase marker: ${marker}`);
    }
}

const source = fs.readFileSync(scriptPath, 'utf8');
for (const endpoint of [
    '/api/import-playlist',
    '/api/playlists',
    '/api/playlist/',
    '/api/admin/enqueue-artists',
    '/api/admin/retry-jobs',
]) {
    if (!source.includes(endpoint)) {
        throw new Error(`missing required endpoint probe: ${endpoint}`);
    }
}

console.log('worker coexistence matrix contract tests passed');
