#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { spawnSync } = require('child_process');
const {
    QUEUE_KEYS,
    CORE_FLOW_ENDPOINTS,
    BLOCKING_REGRESSION_CODES,
} = require('../lib/admin/workerCoexistenceContract');

const DEFAULT_BASE_URL = 'http://localhost:4072';
const DEFAULT_DURATION_SECONDS = 120;

function parseArgs(argv) {
    const args = {
        baseUrl: DEFAULT_BASE_URL,
        durationSeconds: DEFAULT_DURATION_SECONDS,
        report: null,
        dryRun: false,
    };

    for (let i = 0; i < argv.length; i += 1) {
        const token = argv[i];
        if (token === '--base-url') {
            args.baseUrl = argv[i + 1] || args.baseUrl;
            i += 1;
            continue;
        }
        if (token === '--duration-seconds') {
            const value = Number(argv[i + 1]);
            if (!Number.isFinite(value) || value <= 0) {
                throw new Error('--duration-seconds must be a positive number');
            }
            args.durationSeconds = Math.round(value);
            i += 1;
            continue;
        }
        if (token === '--report') {
            args.report = argv[i + 1] || null;
            i += 1;
            continue;
        }
        if (token === '--dry-run') {
            args.dryRun = true;
        }
    }

    return args;
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function requestProbe(baseUrl, endpoint, method = 'GET', body = null) {
    const url = new URL(endpoint, baseUrl);
    const isHttps = url.protocol === 'https:';
    const transport = isHttps ? https : http;
    const payload = body ? JSON.stringify(body) : null;
    const headers = {
        Accept: 'application/json',
    };
    if (payload) {
        headers['Content-Type'] = 'application/json';
        headers['Content-Length'] = Buffer.byteLength(payload);
    }

    return new Promise((resolve) => {
        const req = transport.request(
            {
                protocol: url.protocol,
                hostname: url.hostname,
                port: url.port,
                path: `${url.pathname}${url.search}`,
                method,
                headers,
                timeout: 10000,
            },
            (res) => {
                const chunks = [];
                res.on('data', (chunk) => chunks.push(chunk));
                res.on('end', () => {
                    resolve({
                        endpoint,
                        method,
                        ok: res.statusCode < 500,
                        statusCode: res.statusCode,
                        bodyPreview: Buffer.concat(chunks).toString('utf8').slice(0, 240),
                        error: null,
                        at: new Date().toISOString(),
                    });
                });
            }
        );

        req.on('timeout', () => {
            req.destroy(new Error('timeout'));
        });
        req.on('error', (error) => {
            resolve({
                endpoint,
                method,
                ok: false,
                statusCode: null,
                bodyPreview: null,
                error: error.message,
                at: new Date().toISOString(),
            });
        });

        if (payload) {
            req.write(payload);
        }
        req.end();
    });
}

function captureQueueDepths() {
    const result = {
        at: new Date().toISOString(),
        queues: {},
        available: true,
        error: null,
    };

    for (const [name, key] of Object.entries(QUEUE_KEYS)) {
        const cmd = spawnSync('redis-cli', ['--raw', 'LLEN', key], { encoding: 'utf8' });
        if (cmd.error || cmd.status !== 0) {
            result.available = false;
            result.error = cmd.error ? cmd.error.message : (cmd.stderr || 'redis-cli unavailable').trim();
            result.queues[name] = null;
            continue;
        }
        const depth = Number((cmd.stdout || '').trim());
        result.queues[name] = Number.isFinite(depth) ? depth : null;
    }
    return result;
}

function dryRunPlan(args) {
    const plan = {
        baseUrl: args.baseUrl,
        durationSeconds: args.durationSeconds,
        phases: [
            {
                name: 'baseline',
                description: 'User flow probes only',
                probes: ['/api/import-playlist', '/api/playlists', '/api/playlist/[id]/status'],
            },
            {
                name: 'overlap',
                description: 'User flows plus admin enqueue/retry and queue snapshots',
                probes: CORE_FLOW_ENDPOINTS,
            },
            {
                name: 'recovery',
                description: 'Post-overlap user flow checks and queue snapshots',
                probes: ['/api/playlists', '/api/playlist/[id]/status'],
            },
        ],
    };
    console.log(JSON.stringify(plan, null, 2));
}

function classifyRegressions(evidence) {
    const regressions = [];

    const overlapFlow = evidence.overlap.probes.filter((probe) =>
        ['/api/import-playlist', '/api/playlists', '/api/playlist/'].some((token) => probe.endpoint.includes(token))
    );
    if (overlapFlow.length > 0 && overlapFlow.every((probe) => !probe.ok)) {
        regressions.push({
            code: 'playlist_flow_stalled',
            message: 'All overlap user-flow probes failed',
            blocking: true,
        });
    }

    const probeErrors = evidence.overlap.probes.filter((probe) =>
        probe.error && /ECONNRESET|ECONNREFUSED|socket hang up|timeout/i.test(probe.error)
    );
    if (probeErrors.length >= 3) {
        regressions.push({
            code: 'worker_crash_loop',
            message: 'Repeated network-level overlap failures detected',
            blocking: true,
        });
    }

    const depths = evidence.overlap.queueSnapshots
        .concat(evidence.recovery.queueSnapshots)
        .filter((snapshot) => snapshot.available);
    if (depths.length >= 2) {
        const first = depths[0].queues;
        const last = depths[depths.length - 1].queues;
        const noDrain = Object.keys(first).length > 0
            && Object.keys(first).every((key) =>
                typeof first[key] === 'number'
                && typeof last[key] === 'number'
                && last[key] >= first[key]
            );
        if (noDrain) {
            regressions.push({
                code: 'workers_not_consuming',
                message: 'Queue depths did not drain between overlap and recovery',
                blocking: true,
            });
        }
    }

    for (const entry of regressions) {
        if (!BLOCKING_REGRESSION_CODES.includes(entry.code)) {
            entry.blocking = false;
        }
    }

    return regressions;
}

async function runPhase(args, name, options) {
    const stageDurationMs = Math.max(1000, Math.floor((args.durationSeconds * 1000) / 3));
    const probeBatches = Math.max(1, Math.min(3, options.batches || 2));
    const pauseMs = Math.max(500, Math.floor(stageDurationMs / probeBatches));
    const evidence = {
        startedAt: new Date().toISOString(),
        probes: [],
        queueSnapshots: [],
        completedAt: null,
    };

    for (let i = 0; i < probeBatches; i += 1) {
        for (const probe of options.probes) {
            evidence.probes.push(await requestProbe(args.baseUrl, probe.endpoint, probe.method, probe.body));
        }
        if (options.captureQueueDepths) {
            evidence.queueSnapshots.push(captureQueueDepths());
        }
        if (i < probeBatches - 1) {
            await sleep(pauseMs);
        }
    }

    evidence.completedAt = new Date().toISOString();
    console.log(`[coexistence-matrix] ${name} complete (${evidence.probes.length} probes)`);
    return evidence;
}

function buildReportPath(reportPath) {
    if (!reportPath) return null;
    return path.isAbsolute(reportPath) ? reportPath : path.join(process.cwd(), reportPath);
}

function writeReport(reportPath, evidence) {
    if (!reportPath) return;
    const fullPath = buildReportPath(reportPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, JSON.stringify(evidence, null, 2), 'utf8');
    console.log(`[coexistence-matrix] report written: ${fullPath}`);
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.dryRun) {
        dryRunPlan(args);
        return;
    }

    const evidence = {
        startedAt: new Date().toISOString(),
        baseUrl: args.baseUrl,
        durationSeconds: args.durationSeconds,
        baseline: null,
        overlap: null,
        recovery: null,
        regressions: [],
        finishedAt: null,
    };

    evidence.baseline = await runPhase(args, 'baseline', {
        probes: [
            { method: 'GET', endpoint: '/api/playlists' },
            { method: 'GET', endpoint: '/api/playlist/placeholder/status' },
            { method: 'POST', endpoint: '/api/import-playlist', body: { url: 'https://open.spotify.com/playlist/test' } },
        ],
        captureQueueDepths: true,
        batches: 2,
    });

    evidence.overlap = await runPhase(args, 'overlap', {
        probes: [
            { method: 'POST', endpoint: '/api/admin/enqueue-artists', body: { artists: [] } },
            { method: 'POST', endpoint: '/api/admin/retry-jobs', body: { jobIds: [] } },
            { method: 'POST', endpoint: '/api/import-playlist', body: { url: 'https://open.spotify.com/playlist/test' } },
            { method: 'GET', endpoint: '/api/playlists' },
            { method: 'GET', endpoint: '/api/playlist/placeholder/status' },
        ],
        captureQueueDepths: true,
        batches: 3,
    });

    evidence.recovery = await runPhase(args, 'recovery', {
        probes: [
            { method: 'GET', endpoint: '/api/playlists' },
            { method: 'GET', endpoint: '/api/playlist/placeholder/status' },
        ],
        captureQueueDepths: true,
        batches: 2,
    });

    evidence.regressions = classifyRegressions(evidence);
    evidence.finishedAt = new Date().toISOString();

    writeReport(args.report, evidence);

    const blocking = evidence.regressions.filter((entry) => entry.blocking);
    if (blocking.length > 0) {
        console.error(`[coexistence-matrix] blocking regressions: ${blocking.map((entry) => entry.code).join(', ')}`);
        process.exit(1);
    }
}

main().catch((error) => {
    console.error(`[coexistence-matrix] failed: ${error.message}`);
    process.exit(1);
});
