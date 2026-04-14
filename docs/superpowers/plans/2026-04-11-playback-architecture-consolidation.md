# Playback Architecture Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `PlayerContext + GlobalPlayer` the single canonical playback engine, and remove duplicated player-runtime logic from `components/Player.js`.

**Architecture:** Keep `AppContext` as product-state orchestration (auth/library/import) while delegating playback runtime (YT iframe lifecycle, time/progress, queue navigation) to `PlayerContext`. Mount one persistent hidden YouTube iframe in `_app.js` through `GlobalPlayer`, and make UI controls consume `usePlayer()` state/actions.

**Tech Stack:** Next.js Pages Router, React Context, YouTube IFrame API, MongoDB/Mongoose, SCSS modules.

---

## File structure and responsibilities

- **Modify:** `pages/_app.js`  
  Mount `PlayerProvider` and `GlobalPlayer` once at app root.

- **Modify:** `lib/AppContext.js`  
  Keep app-domain state; bridge track selection to `playTrack()` and queue sync via `usePlayer()`.

- **Modify:** `components/Player.js`  
  Convert from owning YT player internals to rendering controls backed by `usePlayer()`.

- **Modify:** `components/layout/AppLayout.js`  
  Pass minimal props to `Player` (or none), keeping layout responsibilities only.

- **Modify:** `pages/index.js` and `pages/playlist/[id].js`  
  Keep existing user flows, but ensure selection flows remain correct after provider switch.

- **Create:** `scripts/plan-checks/task1-provider-contract.mjs`  
  Static contract check for provider mounting and global player insertion.

- **Create:** `scripts/plan-checks/task2-player-engine-contract.mjs`  
  Static contract check ensuring `components/Player.js` no longer instantiates `window.YT.Player`.

- **Create:** `scripts/plan-checks/task3-selection-contract.mjs`  
  Static contract check for `AppContext` selection bridge (`handleTrackSelect -> playTrack`).

- **Modify:** `README.md`  
  Update architecture section to document canonical playback path.

---

### Task 1: Mount canonical playback provider at app root

**Files:**
- Create: `scripts/plan-checks/task1-provider-contract.mjs`
- Modify: `pages/_app.js`
- Test: `scripts/plan-checks/task1-provider-contract.mjs`

- [ ] **Step 1: Write the failing contract check**

```js
// scripts/plan-checks/task1-provider-contract.mjs
import fs from 'node:fs';

const app = fs.readFileSync('pages/_app.js', 'utf8');

const checks = [
  { name: 'imports PlayerProvider', ok: app.includes("import { PlayerProvider } from '@/context/PlayerContext'") },
  { name: 'imports GlobalPlayer', ok: app.includes("import GlobalPlayer from '@/components/GlobalPlayer'") },
  { name: 'wraps AppProvider in PlayerProvider', ok: /<PlayerProvider>[\s\S]*<AppProvider>/.test(app) },
  { name: 'renders GlobalPlayer once', ok: app.includes('<GlobalPlayer />') },
];

const failed = checks.filter((c) => !c.ok);
if (failed.length) {
  console.error('Task1 contract failed:', failed.map((f) => f.name).join(', '));
  process.exit(1);
}

console.log('Task1 contract passed');
```

- [ ] **Step 2: Run check to verify it fails on current code**

Run: `node scripts/plan-checks/task1-provider-contract.mjs`  
Expected: FAIL with missing `PlayerProvider` and `GlobalPlayer` checks.

- [ ] **Step 3: Implement root provider wiring**

```js
// pages/_app.js (target shape)
import { PlayerProvider } from '@/context/PlayerContext';
import GlobalPlayer from '@/components/GlobalPlayer';
import { AppProvider } from '@/lib/AppContext';

export default function App({ Component, pageProps }) {
  const getLayout = Component.getLayout ?? ((page) => <AppLayout>{page}</AppLayout>);

  return (
    <PlayerProvider>
      <AppProvider>
        <Head>{/* existing metadata */}</Head>
        <GlobalPlayer />
        {getLayout(<Component {...pageProps} />)}
      </AppProvider>
    </PlayerProvider>
  );
}
```

- [ ] **Step 4: Run check to verify pass**

Run: `node scripts/plan-checks/task1-provider-contract.mjs`  
Expected: PASS with `Task1 contract passed`.

- [ ] **Step 5: Commit**

```bash
git add pages/_app.js scripts/plan-checks/task1-provider-contract.mjs
git commit -m "refactor: mount global playback provider and player host"
```

---

### Task 2: Convert Player component to UI-only controls over PlayerContext

**Files:**
- Create: `scripts/plan-checks/task2-player-engine-contract.mjs`
- Modify: `components/Player.js`
- Modify: `components/layout/AppLayout.js`
- Test: `scripts/plan-checks/task2-player-engine-contract.mjs`

- [ ] **Step 1: Write the failing engine contract check**

```js
// scripts/plan-checks/task2-player-engine-contract.mjs
import fs from 'node:fs';

const player = fs.readFileSync('components/Player.js', 'utf8');

const checks = [
  { name: 'uses usePlayer hook', ok: player.includes("import { usePlayer } from '@/context/PlayerContext'") },
  { name: 'does not create window.YT.Player', ok: !player.includes('new window.YT.Player') },
  { name: 'does not load iframe_api script directly', ok: !player.includes('youtube.com/iframe_api') },
];

const failed = checks.filter((c) => !c.ok);
if (failed.length) {
  console.error('Task2 contract failed:', failed.map((f) => f.name).join(', '));
  process.exit(1);
}

console.log('Task2 contract passed');
```

- [ ] **Step 2: Run check to verify it fails**

Run: `node scripts/plan-checks/task2-player-engine-contract.mjs`  
Expected: FAIL because current `Player.js` directly creates and manages YT player.

- [ ] **Step 3: Refactor Player to consume context state/actions**

```js
// components/Player.js (target shape excerpt)
import { usePlayer } from '@/context/PlayerContext';

export default function Player({ track, playlist, currentIndex, onTrackChange, playlistId }) {
  const {
    isPlaying,
    currentTime,
    duration,
    volume,
    togglePlay,
    seek,
    setVolume,
    playNext,
    playPrevious,
    isLoading,
  } = usePlayer();

  // keep existing UI markup, wire controls to context actions:
  // - play/pause button -> togglePlay()
  // - progress click -> seek(seconds)
  // - prev/next -> playPrevious()/playNext()
  // - volume slider -> setVolume(value)
  // - no YT script injection, no local YT.Player lifecycle
}
```

- [ ] **Step 4: Keep AppLayout integration minimal**

```js
// components/layout/AppLayout.js (target shape excerpt)
<Player
  track={currentTrack}
  playlist={tracks}
  currentIndex={currentIndex}
  onTrackChange={handleTrackChange}
  playlistId={activePlaylist?.id}
/>
```

- [ ] **Step 5: Run contract check to verify pass**

Run: `node scripts/plan-checks/task2-player-engine-contract.mjs`  
Expected: PASS with `Task2 contract passed`.

- [ ] **Step 6: Commit**

```bash
git add components/Player.js components/layout/AppLayout.js scripts/plan-checks/task2-player-engine-contract.mjs
git commit -m "refactor: make Player UI use global playback context"
```

---

### Task 3: Bridge AppContext selection flow to PlayerContext runtime

**Files:**
- Create: `scripts/plan-checks/task3-selection-contract.mjs`
- Modify: `lib/AppContext.js`
- Modify: `pages/index.js`
- Modify: `pages/playlist/[id].js`
- Test: `scripts/plan-checks/task3-selection-contract.mjs`

- [ ] **Step 1: Write the failing selection contract check**

```js
// scripts/plan-checks/task3-selection-contract.mjs
import fs from 'node:fs';

const appCtx = fs.readFileSync('lib/AppContext.js', 'utf8');

const checks = [
  { name: 'imports usePlayer', ok: appCtx.includes("import { usePlayer } from '@/context/PlayerContext'") },
  { name: 'handleTrackSelect delegates to playTrack', ok: /handleTrackSelect[\s\S]*playTrack\(/.test(appCtx) },
  { name: 'queue synchronized with setQueue', ok: /useEffect\([\s\S]*setQueue\(tracks\)/.test(appCtx) },
];

const failed = checks.filter((c) => !c.ok);
if (failed.length) {
  console.error('Task3 contract failed:', failed.map((f) => f.name).join(', '));
  process.exit(1);
}

console.log('Task3 contract passed');
```

- [ ] **Step 2: Run check to verify it fails**

Run: `node scripts/plan-checks/task3-selection-contract.mjs`  
Expected: FAIL because current AppContext does not call `playTrack` or `setQueue`.

- [ ] **Step 3: Implement selection bridge in AppContext**

```js
// lib/AppContext.js (target shape excerpt)
import { usePlayer } from '@/context/PlayerContext';

export function AppProvider({ children }) {
  const { playTrack, setQueue } = usePlayer();

  useEffect(() => {
    setQueue(tracks || []);
  }, [tracks, setQueue]);

  const handleTrackSelect = useCallback((track, index) => {
    setCurrentTrack(track);
    setCurrentIndex(index);
    playTrack(track, index, tracks);
  }, [playTrack, tracks]);
}
```

- [ ] **Step 4: Keep page-level handlers unchanged but verified**

```js
// pages/index.js and pages/playlist/[id].js
// continue calling handleTrackSelect(track, index)
// no page-level direct YT logic
```

- [ ] **Step 5: Run contract check**

Run: `node scripts/plan-checks/task3-selection-contract.mjs`  
Expected: PASS with `Task3 contract passed`.

- [ ] **Step 6: Commit**

```bash
git add lib/AppContext.js pages/index.js pages/playlist/[id].js scripts/plan-checks/task3-selection-contract.mjs
git commit -m "refactor: route track selection through PlayerContext runtime"
```

---

### Task 4: Final verification and architecture documentation update

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-04-11-nextjs-architecture-design.md`
- Test: `package.json` scripts (`npm run build`)

- [ ] **Step 1: Update architecture docs to canonical path**

```md
Canonical playback path:
- `_app.js` mounts `PlayerProvider` + `GlobalPlayer`
- `PlayerContext` owns YT iframe lifecycle and playback state
- `AppContext` routes track selection into `playTrack`
- `components/Player.js` renders controls only
```

- [ ] **Step 2: Run production build verification**

Run: `npm run build`  
Expected: Next.js build succeeds with no compile/runtime hook-order errors.

- [ ] **Step 3: Manual smoke verification in dev**

Run: `npm run dev`  
Expected: app starts, login works, playlist load works, track continues playing while navigating `/` <-> `/playlist/[id]`.

- [ ] **Step 4: Commit final docs/verification adjustments**

```bash
git add README.md docs/superpowers/specs/2026-04-11-nextjs-architecture-design.md
git commit -m "docs: record canonical global playback architecture"
```

---

## Self-review

### 1. Spec coverage
- **Playback canonicalization:** covered by Tasks 1-3.
- **Global player background behavior clarity:** covered by Tasks 1, 2, 4.
- **Architecture doc alignment:** covered by Task 4.
- **No major spec gap detected** for the selected scope (“Playback architecture consolidation”).

### 2. Placeholder scan
- No `TODO`/`TBD` placeholders present.
- Commands, files, and target code shapes are specified for each task.

### 3. Type/signature consistency
- `handleTrackSelect(track, index)` signature remains stable across pages/components.
- `usePlayer` actions referenced consistently: `playTrack`, `setQueue`, `togglePlay`, `seek`, `setVolume`, `playNext`, `playPrevious`.

