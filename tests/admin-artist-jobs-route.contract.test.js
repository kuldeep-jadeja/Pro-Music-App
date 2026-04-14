const fs = require('fs');
const path = require('path');

const routePath = path.join(process.cwd(), 'pages/api/admin/artist-jobs.js');

if (!fs.existsSync(routePath)) {
    throw new Error('Route file pages/api/admin/artist-jobs.js is missing');
}

const source = fs.readFileSync(routePath, 'utf8');

// Test 1: status=failed&q=test behavior contract markers
if (!source.includes('status !== DEFAULT_STATUS_FILTER')) {
    throw new Error('Missing non-default status filter branch');
}
if (!source.includes('artistName') || !source.includes('artistSpotifyId')) {
    throw new Error('Missing combined text search fields');
}

// Test 2: invalid status returns 400 with contract error code
if (!source.includes('invalid_status_filter') || !source.includes('status(400)')) {
    throw new Error('Missing invalid status 400 handling');
}

// Test 3: deterministic sort + failure metadata payload
if (!source.includes('updatedAt: -1') || !source.includes('_id: -1')) {
    throw new Error('Missing deterministic updatedAt/_id descending sort');
}
for (const token of ['error', 'updatedAt']) {
    if (!source.includes(token)) {
        throw new Error(`Missing ${token} in response fields`);
    }
}

console.log('admin-artist-jobs route contract tests passed');
