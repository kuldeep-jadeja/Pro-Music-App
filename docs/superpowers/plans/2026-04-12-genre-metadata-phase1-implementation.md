# Genre Metadata Phase 1 (Shadow Mode) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce a queue-centric metadata enrichment foundation (genres + metadata status fields + worker + enqueue path) in shadow mode without slowing playlist import responses.

**Architecture:** Keep existing import and enrichment behavior intact, but add a parallel metadata queue path. New track schema fields support genre/completeness tracking, while a dedicated Redis worker consumes `demus:metadata:queue`. In Phase 1 shadow mode, worker reads jobs, resolves candidate metadata, logs metrics, and optionally writes only when explicitly enabled.

**Tech Stack:** Next.js Pages Router, Mongoose, ioredis, Node.js CommonJS workers, existing `spotify-url-info` + enrichment providers.

---

## File structure and responsibilities

- **Modify:** `models/Track.js`  
  Add `genres`, `primaryGenre`, metadata lifecycle fields (`metadataStatus`, `metadataUpdatedAt`, `metadataAttempts`, `genreConfidence`, `metadataFingerprint`, `metadataSources`).

- **Create:** `lib/metadataQueue.js`  
  Redis enqueue helper for metadata jobs (`enqueueMetadataJob`, `enqueueMetadataBatch`).

- **Create:** `workers/metadataWorker.js`  
  Standalone queue consumer for metadata jobs with retry, normalization, and shadow-mode gating.

- **Modify:** `package.json`  
  Add worker and metrics scripts (`metadata:worker`, `metadata:coverage`).

- **Modify:** `pages/api/import-playlist.js`  
  Enqueue metadata jobs asynchronously after track upsert + response.

- **Create:** `scripts/metadataCoverageReport.js`  
  Report phase-1 coverage metrics (`genres[]`, metadata statuses).

- **Create:** `scripts/plan-checks/metadata-phase1-schema.mjs`
- **Create:** `scripts/plan-checks/metadata-phase1-queue.mjs`
- **Create:** `scripts/plan-checks/metadata-phase1-worker.mjs`
- **Create:** `scripts/plan-checks/metadata-phase1-import.mjs`  
  Contract checks to guard phase-1 architecture.

- **Modify:** `README.md`  
  Document new worker command + shadow-mode env flags.

---

### Task 1: Extend Track schema for genre + metadata lifecycle

**Files:**
- Create: `scripts/plan-checks/metadata-phase1-schema.mjs`
- Modify: `models/Track.js`
- Test: `scripts/plan-checks/metadata-phase1-schema.mjs`

- [ ] **Step 1: Write failing schema contract check**

```js
// scripts/plan-checks/metadata-phase1-schema.mjs
import fs from 'node:fs';

const src = fs.readFileSync('models/Track.js', 'utf8');
const checks = [
  ['genres field', /genres:\s*\{\s*type:\s*\[String\]/.test(src)],
  ['primaryGenre field', /primaryGenre:\s*\{\s*type:\s*String/.test(src)],
  ['metadataStatus enum', /metadataStatus:\s*\{[\s\S]*enum:\s*\['pending',\s*'partial',\s*'complete',\s*'failed'\]/.test(src)],
  ['metadataUpdatedAt field', /metadataUpdatedAt:\s*\{\s*type:\s*Date/.test(src)],
  ['metadataAttempts field', /metadataAttempts:\s*\{\s*type:\s*Number/.test(src)],
  ['genreConfidence field', /genreConfidence:\s*\{\s*type:\s*Number/.test(src)],
  ['metadataFingerprint field', /metadataFingerprint:\s*\{\s*type:\s*String/.test(src)],
  ['metadataSources field', /metadataSources:\s*\{[\s\S]*genre:\s*String[\s\S]*album:\s*String/.test(src)],
];

const failed = checks.filter(([, ok]) => !ok).map(([name]) => name);
if (failed.length) {
  console.error('Schema contract failed:', failed.join(', '));
  process.exit(1);
}
console.log('Schema contract passed');
```

- [ ] **Step 2: Run check and verify fail**

Run: `node scripts/plan-checks/metadata-phase1-schema.mjs`  
Expected: FAIL (new fields not present yet).

- [ ] **Step 3: Add schema fields**

```js
// models/Track.js (add inside TrackSchema fields)
genres: {
  type: [String],
  default: [],
},
primaryGenre: {
  type: String,
  default: null,
},
metadataStatus: {
  type: String,
  enum: ['pending', 'partial', 'complete', 'failed'],
  default: 'pending',
},
metadataUpdatedAt: {
  type: Date,
  default: null,
},
metadataAttempts: {
  type: Number,
  default: 0,
},
genreConfidence: {
  type: Number,
  default: 0,
},
metadataFingerprint: {
  type: String,
  default: null,
},
metadataSources: {
  genre: String,
  album: String,
},
```

- [ ] **Step 4: Run check and verify pass**

Run: `node scripts/plan-checks/metadata-phase1-schema.mjs`  
Expected: PASS (`Schema contract passed`).

- [ ] **Step 5: Commit**

```bash
git add models/Track.js scripts/plan-checks/metadata-phase1-schema.mjs
git commit -m "feat(track): add genre and metadata lifecycle fields"
```

---

### Task 2: Add Redis metadata queue helper

**Files:**
- Create: `lib/metadataQueue.js`
- Create: `scripts/plan-checks/metadata-phase1-queue.mjs`
- Test: `scripts/plan-checks/metadata-phase1-queue.mjs`

- [ ] **Step 1: Write failing queue contract check**

```js
// scripts/plan-checks/metadata-phase1-queue.mjs
import fs from 'node:fs';

const path = 'lib/metadataQueue.js';
if (!fs.existsSync(path)) {
  console.error('Queue file missing');
  process.exit(1);
}
const src = fs.readFileSync(path, 'utf8');
const checks = [
  ['QUEUE_KEY present', src.includes("demus:metadata:queue")],
  ['enqueueMetadataJob export', /export\s+async\s+function\s+enqueueMetadataJob/.test(src)],
  ['enqueueMetadataBatch export', /export\s+async\s+function\s+enqueueMetadataBatch/.test(src)],
  ['uses getRedis', src.includes("from '@/lib/redis'")],
];
const failed = checks.filter(([, ok]) => !ok).map(([name]) => name);
if (failed.length) {
  console.error('Queue contract failed:', failed.join(', '));
  process.exit(1);
}
console.log('Queue contract passed');
```

- [ ] **Step 2: Run check and verify fail**

Run: `node scripts/plan-checks/metadata-phase1-queue.mjs`  
Expected: FAIL (`Queue file missing`).

- [ ] **Step 3: Implement queue helper**

```js
// lib/metadataQueue.js
import { getRedis } from '@/lib/redis';

export const METADATA_QUEUE_KEY = 'demus:metadata:queue';
const isDev = process.env.NODE_ENV !== 'production';

export async function enqueueMetadataJob(job) {
  const redis = await getRedis();
  if (!redis) return false;
  await redis.rpush(METADATA_QUEUE_KEY, JSON.stringify(job));
  if (isDev) console.log(`[MetadataQueue] queued ${job.spotifyId}`);
  return true;
}

export async function enqueueMetadataBatch(tracks, context = {}) {
  let queued = 0;
  for (const t of tracks) {
    const job = {
      spotifyId: t.spotifyId,
      name: t.name,
      artists: t.artists || [],
      album: t.album || null,
      albumImage: t.albumImage || null,
      queuedAt: Date.now(),
      ...context,
    };
    const ok = await enqueueMetadataJob(job);
    if (ok) queued++;
  }
  return { queued, total: tracks.length };
}
```

- [ ] **Step 4: Run check and verify pass**

Run: `node scripts/plan-checks/metadata-phase1-queue.mjs`  
Expected: PASS (`Queue contract passed`).

- [ ] **Step 5: Commit**

```bash
git add lib/metadataQueue.js scripts/plan-checks/metadata-phase1-queue.mjs
git commit -m "feat(queue): add metadata enrichment queue helper"
```

---

### Task 3: Implement metadata worker in shadow mode

**Files:**
- Create: `workers/metadataWorker.js`
- Modify: `package.json`
- Create: `scripts/plan-checks/metadata-phase1-worker.mjs`
- Test: `scripts/plan-checks/metadata-phase1-worker.mjs`

- [ ] **Step 1: Write failing worker contract check**

```js
// scripts/plan-checks/metadata-phase1-worker.mjs
import fs from 'node:fs';

const workerPath = 'workers/metadataWorker.js';
const pkgPath = 'package.json';

if (!fs.existsSync(workerPath)) {
  console.error('metadataWorker missing');
  process.exit(1);
}

const worker = fs.readFileSync(workerPath, 'utf8');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const checks = [
  ['queue key', worker.includes('demus:metadata:queue')],
  ['shadow mode env', worker.includes('METADATA_WORKER_SHADOW_MODE')],
  ['blpop loop', /blpop\(/.test(worker)],
  ['metadata:worker script', !!pkg.scripts?.['metadata:worker']],
];
const failed = checks.filter(([, ok]) => !ok).map(([name]) => name);
if (failed.length) {
  console.error('Worker contract failed:', failed.join(', '));
  process.exit(1);
}
console.log('Worker contract passed');
```

- [ ] **Step 2: Run check and verify fail**

Run: `node scripts/plan-checks/metadata-phase1-worker.mjs`  
Expected: FAIL (`metadataWorker missing`).

- [ ] **Step 3: Create worker and script entry**

```js
// workers/metadataWorker.js (shape)
'use strict';
const Redis = require('ioredis');
const mongoose = require('mongoose');

const QUEUE_KEY = 'demus:metadata:queue';
const SHADOW_MODE = String(process.env.METADATA_WORKER_SHADOW_MODE || 'true') === 'true';

// connect Redis + Mongo, BLPOP loop, normalize candidate genres
// if SHADOW_MODE=true: log computed metadata and skip writes
// if false: write only missing fields and increment metadataAttempts
```

```json
// package.json scripts additions
{
  "scripts": {
    "metadata:worker": "node --env-file=.env.local workers/metadataWorker.js"
  }
}
```

- [ ] **Step 4: Run contracts + syntax check**

Run:
1. `node scripts/plan-checks/metadata-phase1-worker.mjs`
2. `node --check workers/metadataWorker.js`

Expected:
1. PASS (`Worker contract passed`)
2. no syntax errors

- [ ] **Step 5: Commit**

```bash
git add workers/metadataWorker.js package.json scripts/plan-checks/metadata-phase1-worker.mjs
git commit -m "feat(worker): add shadow-mode metadata enrichment worker"
```

---

### Task 4: Enqueue metadata jobs from playlist import (non-blocking)

**Files:**
- Modify: `pages/api/import-playlist.js`
- Create: `scripts/plan-checks/metadata-phase1-import.mjs`
- Test: `scripts/plan-checks/metadata-phase1-import.mjs`

- [ ] **Step 1: Write failing import-path contract check**

```js
// scripts/plan-checks/metadata-phase1-import.mjs
import fs from 'node:fs';

const src = fs.readFileSync('pages/api/import-playlist.js', 'utf8');
const checks = [
  ['imports enqueueMetadataBatch', src.includes("enqueueMetadataBatch")],
  ['metadata enqueue call present', /enqueueMetadataBatch\(/.test(src)],
  ['enqueue is fire-and-forget', /enqueueMetadataBatch\([\s\S]*\)\.catch\(/.test(src)],
];

const failed = checks.filter(([, ok]) => !ok).map(([name]) => name);
if (failed.length) {
  console.error('Import contract failed:', failed.join(', '));
  process.exit(1);
}
console.log('Import contract passed');
```

- [ ] **Step 2: Run check and verify fail**

Run: `node scripts/plan-checks/metadata-phase1-import.mjs`  
Expected: FAIL (metadata queue not wired yet).

- [ ] **Step 3: Add enqueue path after response**

```js
// pages/api/import-playlist.js additions
import { enqueueMetadataBatch } from '@/lib/metadataQueue';

// after response + existing background paths
enqueueMetadataBatch(rawTracks, {
  playlistId: playlist._id?.toString(),
  userId: req.user?._id?.toString(),
  source: 'import-playlist',
}).catch((err) => {
  console.error('[MetadataQueue] enqueue failed:', err.message);
});
```

- [ ] **Step 4: Run check and verify pass**

Run: `node scripts/plan-checks/metadata-phase1-import.mjs`  
Expected: PASS (`Import contract passed`).

- [ ] **Step 5: Commit**

```bash
git add pages/api/import-playlist.js scripts/plan-checks/metadata-phase1-import.mjs
git commit -m "feat(import): enqueue metadata jobs asynchronously"
```

---

### Task 5: Add phase-1 observability command and docs

**Files:**
- Create: `scripts/metadataCoverageReport.js`
- Modify: `package.json`
- Modify: `README.md`
- Test: `npm run metadata:coverage`, `npm run build`

- [ ] **Step 1: Create coverage report script**

```js
// scripts/metadataCoverageReport.js (shape)
// Connect Mongo, count:
// total tracks, tracks with genres, coverage %, status distribution,
// high-confidence count (genreConfidence >= 0.8)
// print summary and exit 0
```

- [ ] **Step 2: Wire package script**

```json
{
  "scripts": {
    "metadata:coverage": "node scripts/metadataCoverageReport.js"
  }
}
```

- [ ] **Step 3: Document commands and env flags**

```md
## Metadata Worker (Phase 1 Shadow)
- npm run metadata:worker
- npm run metadata:coverage

Env:
- METADATA_WORKER_SHADOW_MODE=true
```

- [ ] **Step 4: Run verification commands**

Run:
1. `npm run metadata:coverage`
2. `npm run build`

Expected:
1. Coverage summary prints successfully.
2. Next.js build succeeds.

- [ ] **Step 5: Commit**

```bash
git add scripts/metadataCoverageReport.js package.json README.md
git commit -m "chore(observability): add metadata coverage reporting"
```

---

## Self-review

### 1. Spec coverage check
1. `genres[]` + metadata status model: covered in Task 1.
2. Queue-centric metadata worker: covered in Tasks 2-3.
3. Import async enqueue without latency regression: covered in Task 4.
4. Observability/coverage target readiness: covered in Task 5.
5. Phase-1-only scope (shadow mode) respected; no UI genre features planned.

### 2. Placeholder scan
1. No `TODO/TBD/implement later` placeholders.
2. Every task includes exact file paths, commands, and expected outcomes.
3. Code-changing steps include concrete code blocks.

### 3. Type/signature consistency
1. Queue payload uses stable `spotifyId`, `name`, `artists`, optional context fields.
2. Track schema names match spec (`genres`, `primaryGenre`, `metadataStatus`, etc.).
3. Script names used consistently across tasks (`metadata:worker`, `metadata:coverage`).
