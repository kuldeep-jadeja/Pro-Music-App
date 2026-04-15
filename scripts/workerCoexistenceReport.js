#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { BLOCKING_REGRESSION_CODES } = require('../lib/admin/workerCoexistenceContract');

function parseArgs(argv) {
    const args = { report: null, sample: null };
    for (let i = 0; i < argv.length; i += 1) {
        const token = argv[i];
        if (token === '--report') {
            args.report = argv[i + 1] || null;
            i += 1;
            continue;
        }
        if (token === '--sample') {
            args.sample = argv[i + 1] || null;
            i += 1;
        }
    }
    return args;
}

function validateSections(payload) {
    for (const key of ['baseline', 'overlap', 'recovery', 'regressions']) {
        if (!Object.prototype.hasOwnProperty.call(payload, key)) {
            throw new Error(`Missing required section: ${key}`);
        }
    }
    if (!Array.isArray(payload.regressions)) {
        throw new Error('regressions must be an array');
    }
}

function getBlockingRegressions(regressions) {
    const blockingSet = new Set(BLOCKING_REGRESSION_CODES);
    return regressions.filter((entry) => {
        const code = typeof entry === 'string' ? entry : entry?.code;
        return blockingSet.has(code);
    });
}

function loadSample(sample) {
    if (sample === 'pass') {
        return {
            baseline: {},
            overlap: {},
            recovery: {},
            regressions: [],
        };
    }
    if (sample === 'fail') {
        return {
            baseline: {},
            overlap: {},
            recovery: {},
            regressions: [{ code: BLOCKING_REGRESSION_CODES[0], message: 'sample blocking regression' }],
        };
    }
    throw new Error(`Unknown --sample mode: ${sample}. Use pass|fail.`);
}

function loadReport(reportPath) {
    if (!reportPath) {
        throw new Error('Missing required --report <jsonPath> (or use --sample pass|fail).');
    }
    const fullPath = path.resolve(process.cwd(), reportPath);
    if (!fs.existsSync(fullPath)) {
        throw new Error(`Report file not found: ${reportPath}`);
    }
    return JSON.parse(fs.readFileSync(fullPath, 'utf8'));
}

function main() {
    const args = parseArgs(process.argv.slice(2));
    const payload = args.sample ? loadSample(args.sample) : loadReport(args.report);
    validateSections(payload);

    const blocking = getBlockingRegressions(payload.regressions);
    if (blocking.length > 0) {
        const codes = blocking.map((entry) => (typeof entry === 'string' ? entry : entry.code)).join(', ');
        console.error(`[coexistence-report] FAIL blocking regressions: ${codes}`);
        process.exit(1);
    }

    console.log('[coexistence-report] PASS no blocking regressions detected');
}

try {
    main();
} catch (error) {
    console.error(`[coexistence-report] ERROR ${error.message}`);
    process.exit(1);
}
