#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function fail(message) {
    throw new Error(message);
}

function runNode(args) {
    return spawnSync(process.execPath, args, {
        cwd: process.cwd(),
        encoding: 'utf8',
    });
}

function assertScript(command, expectedExit) {
    const result = runNode(command);
    if (result.status !== expectedExit) {
        fail(
            `Expected "${command.join(' ')}" to exit ${expectedExit}, got ${result.status}\n` +
            `${result.stderr || result.stdout || ''}`
        );
    }
}

function main() {
    assertScript(['scripts/workerCoexistenceReport.js', '--sample', 'pass'], 0);
    assertScript(['scripts/workerCoexistenceReport.js', '--sample', 'fail'], 1);

    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
    for (const key of ['coexistence:matrix', 'coexistence:smoke', 'coexistence:verify']) {
        if (!pkg.scripts || !pkg.scripts[key]) {
            fail(`Missing package script: ${key}`);
        }
    }

    const runbookPath = path.join(process.cwd(), 'docs', 'phase-04-coexistence.md');
    if (!fs.existsSync(runbookPath)) {
        fail('Missing docs/phase-04-coexistence.md');
    }
}

try {
    main();
    console.log('worker-coexistence-report-smoke: PASS');
} catch (error) {
    console.error(`worker-coexistence-report-smoke: FAIL - ${error.message}`);
    process.exit(1);
}
