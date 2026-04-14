import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appContextPath = path.resolve(scriptDir, '..', '..', 'lib', 'AppContext.js');
const homePagePath = path.resolve(scriptDir, '..', '..', 'pages', 'index.js');
const playlistPagePath = path.resolve(scriptDir, '..', '..', 'pages', 'playlist', '[id].js');

const appContextSource = readFileSync(appContextPath, 'utf8');
const homePageSource = readFileSync(homePagePath, 'utf8');
const playlistPageSource = readFileSync(playlistPagePath, 'utf8');

const handleTrackSelectMatch = appContextSource.match(
  /const\s+handleTrackSelect\s*=\s*useCallback\(\s*\(track,\s*index\)\s*=>\s*\{([\s\S]*?)\}\s*,\s*\[[^\]]*\]\s*\);/
);

const handleTrackSelectBody = handleTrackSelectMatch?.[1] || '';

const checks = [
  {
    message: "AppContext imports usePlayer from '@/context/PlayerContext'",
    pass: /import\s*\{\s*usePlayer\s*\}\s*from\s*['\"]@\/context\/PlayerContext['\"];?/.test(appContextSource),
  },
  {
    message: 'AppContext reads playTrack and setQueue from usePlayer()',
    pass: /const\s*\{[\s\S]*\bplayTrack\b[\s\S]*\bsetQueue\b[\s\S]*\}\s*=\s*usePlayer\(\);/.test(appContextSource),
  },
  {
    message: 'handleTrackSelect delegates to playTrack(track, index, tracks)',
    pass: /playTrack\(track,\s*index,\s*tracks\);/.test(handleTrackSelectBody),
  },
  {
    message: 'handleTrackSelect preserves currentTrack/currentIndex state updates for UI consumers',
    pass:
      /setCurrentTrack\(track\);/.test(handleTrackSelectBody)
      && /setCurrentIndex\(index\);/.test(handleTrackSelectBody),
  },
  {
    message: 'queue sync updates player queue when tracks change',
    pass: /useEffect\(\s*\(\)\s*=>\s*\{\s*setQueue\(tracks\s*\|\|\s*\[\]\);\s*\}\s*,\s*\[\s*tracks\s*,\s*setQueue\s*\]\s*\);/.test(appContextSource),
  },
  {
    message: 'Home page avoids page-level PlayerContext/YouTube runtime logic',
    pass:
      !/from\s*['\"]@\/context\/PlayerContext['\"]/.test(homePageSource)
      && !/\bplayTrack\s*\(/.test(homePageSource)
      && !/window\.YT|iframe_api/.test(homePageSource),
  },
  {
    message: 'Playlist page avoids page-level PlayerContext/YouTube runtime logic',
    pass:
      !/from\s*['\"]@\/context\/PlayerContext['\"]/.test(playlistPageSource)
      && !/\bplayTrack\s*\(/.test(playlistPageSource)
      && !/window\.YT|iframe_api/.test(playlistPageSource),
  },
  {
    message: 'Playlist page selection handlers still call handleTrackSelect(track, index)',
    pass:
      /handleTrackSelect\(first,\s*tracks\.indexOf\(first\)\);/.test(playlistPageSource)
      && /handleTrackSelect\(pick,\s*tracks\.indexOf\(pick\)\);/.test(playlistPageSource),
  },
  {
    message: 'Home page still wires handleTrackSelect into track selection props',
    pass: (homePageSource.match(/onTrackSelect=\{handleTrackSelect\}/g) || []).length >= 2,
  },
];

const failures = checks.filter((check) => !check.pass);

if (failures.length > 0) {
  console.error('Task 3 track selection contract failed:');
  for (const failure of failures) {
    console.error(`- ${failure.message}`);
  }
  process.exit(1);
}

console.log('Task 3 track selection contract passed.');