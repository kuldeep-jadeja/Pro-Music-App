#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const contractPath = path.join(process.cwd(), 'lib', 'admin', 'workerCoexistenceContract.js');
const {
    WORKER_TARGETS,
    QUEUE_KEYS,
    CORE_FLOW_ENDPOINTS,
    BLOCKING_REGRESSION_CODES,
} = require(contractPath);

function fail(message) {
    throw new Error(message);
}

function parseArgs(argv) {
    const args = { check: null, report: null };
    for (let i = 0; i < argv.length; i += 1) {
        const token = argv[i];
        if (token === '--check') {
            args.check = argv[i + 1] || null;
            i += 1;
            continue;
        }
        if (token === '--report') {
            args.report = argv[i + 1] || null;
            i += 1;
        }
    }
    return args;
}

function readSource(relativePath) {
    const fullPath = path.join(process.cwd(), relativePath);
    if (!fs.existsSync(fullPath)) {
        fail(`Missing required file: ${relativePath}`);
    }
    return fs.readFileSync(fullPath, 'utf8');
}

function assertIncludes(source, token, message) {
    if (!source.includes(token)) {
        fail(message);
    }
}

function checkQueueIsolation() {
    const requiredWorkers = ['metadataWorker', 'artistCrawler', 'chartsWorker', 'ytMatchWorker', 'artistExpandWorker'];
    for (const worker of requiredWorkers) {
        if (!WORKER_TARGETS.includes(worker)) {
            fail(`WORKER_TARGETS missing ${worker}`);
        }
    }

    const artistExpandQueue = readSource('lib/artistExpandQueue.js');
    assertIncludes(
        artistExpandQueue,
        `ARTIST_EXPAND_QUEUE_KEY = '${QUEUE_KEYS.artistExpand}'`,
        'Artist expand queue key contract mismatch'
    );

    const ytMatchQueue = readSource('lib/redisQueue.js');
    assertIncludes(
        ytMatchQueue,
        `QUEUE_KEY = '${QUEUE_KEYS.ytMatch}'`,
        'YT match queue key contract mismatch'
    );

    const metadataQueue = readSource('lib/metadataQueue.js');
    assertIncludes(
        metadataQueue,
        `METADATA_QUEUE_KEY = '${QUEUE_KEYS.metadata}'`,
        'Metadata queue key contract mismatch'
    );

    const artistExpandWorker = readSource('workers/artistExpandWorker.js');
    assertIncludes(
        artistExpandWorker,
        `const ARTIST_EXPAND_QUEUE_KEY = '${QUEUE_KEYS.artistExpand}'`,
        'artistExpandWorker queue key mismatch'
    );
    assertIncludes(
        artistExpandWorker,
        'redis.blpop(ARTIST_EXPAND_QUEUE_KEY',
        'artistExpandWorker must consume only artist expansion queue'
    );
    assertIncludes(
        artistExpandWorker,
        `const YTMATCH_QUEUE_KEY = '${QUEUE_KEYS.ytMatch}'`,
        'artistExpandWorker outbound ytmatch queue key mismatch'
    );

    if (artistExpandWorker.includes('redis.blpop(YTMATCH_QUEUE_KEY')) {
        fail('artistExpandWorker must not consume ytmatch queue');
    }

    const ytMatchWorker = readSource('workers/ytMatchWorker.js');
    assertIncludes(
        ytMatchWorker,
        `const QUEUE_KEY = '${QUEUE_KEYS.ytMatch}'`,
        'ytMatchWorker queue key mismatch'
    );
    assertIncludes(
        ytMatchWorker,
        'redis.blpop(QUEUE_KEY',
        'ytMatchWorker must consume ytmatch queue'
    );

    const metadataWorker = readSource('workers/metadataWorker.js');
    assertIncludes(
        metadataWorker,
        `const QUEUE_KEY = '${QUEUE_KEYS.metadata}'`,
        'metadataWorker queue key mismatch'
    );
    assertIncludes(
        metadataWorker,
        'redis.blpop(QUEUE_KEY',
        'metadataWorker must consume metadata queue'
    );
}

function checkUserFlows() {
    const requiredEndpoints = [
        '/api/import-playlist',
        '/api/playlists',
        '/api/playlist/[id]/status',
        '/api/admin/enqueue-artists',
        '/api/admin/retry-jobs',
    ];
    for (const endpoint of requiredEndpoints) {
        if (!CORE_FLOW_ENDPOINTS.includes(endpoint)) {
            fail(`CORE_FLOW_ENDPOINTS missing ${endpoint}`);
        }
    }

    const routeCoverage = [
        ['pages/api/import-playlist.js', 'async function handler'],
        ['pages/api/playlists.js', 'async function handler'],
        ['pages/api/playlist/[id]/status.js', 'async function handler'],
        ['pages/api/admin/enqueue-artists.js', "requireAdmin(handler)"],
        ['pages/api/admin/retry-jobs.js', "requireAdmin(handler)"],
    ];
    for (const [file, token] of routeCoverage) {
        const source = readSource(file);
        assertIncludes(source, token, `Missing expected flow probe token in ${file}`);
    }
}

function checkOverlapRegressions(reportPath) {
    if (!reportPath) {
        fail('--report <jsonPath> is required for overlap-regressions');
    }
    const fullPath = path.resolve(process.cwd(), reportPath);
    if (!fs.existsSync(fullPath)) {
        fail(`Report not found: ${reportPath}`);
    }
    const payload = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
    for (const section of ['baseline', 'overlap', 'recovery', 'regressions']) {
        if (!Object.prototype.hasOwnProperty.call(payload, section)) {
            fail(`Missing report section: ${section}`);
        }
    }
    if (!Array.isArray(payload.regressions)) {
        fail('Report regressions must be an array');
    }

    const blocking = new Set(BLOCKING_REGRESSION_CODES);
    const found = payload.regressions.filter((entry) => {
        const code = typeof entry === 'string' ? entry : entry?.code;
        return blocking.has(code);
    });

    if (found.length > 0) {
        fail(`Blocking regression(s) present: ${found.map((entry) => (typeof entry === 'string' ? entry : entry.code)).join(', ')}`);
    }
}

function main() {
    const args = parseArgs(process.argv.slice(2));
    if (!args.check) {
        fail('Missing --check queue-isolation|user-flows|overlap-regressions');
    }
    if (args.check === 'queue-isolation') {
        checkQueueIsolation();
        console.log('queue-isolation: PASS');
        return;
    }
    if (args.check === 'user-flows') {
        checkUserFlows();
        console.log('user-flows: PASS');
        return;
    }
    if (args.check === 'overlap-regressions') {
        checkOverlapRegressions(args.report);
        console.log('overlap-regressions: PASS');
        return;
    }
    fail(`Unknown --check value: ${args.check}`);
}

try {
    main();
} catch (error) {
    console.error(`worker-coexistence smoke failed: ${error.message}`);
    process.exit(1);
}
