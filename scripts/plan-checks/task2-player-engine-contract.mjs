import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const playerFilePath = path.resolve(scriptDir, '..', '..', 'components', 'Player.js');
const playerSource = readFileSync(playerFilePath, 'utf8');

const requiredBindings = [
  'isPlaying',
  'currentTime',
  'duration',
  'volume',
  'togglePlay',
  'seek',
  'setVolume',
  'playNext',
  'playPrevious',
];

const forbiddenBindings = ['isShuffleOn', 'repeatMode', 'toggleShuffle', 'cycleRepeat'];
const usePlayerMatch = playerSource.match(/const\s*\{([\s\S]*?)\}\s*=\s*usePlayer\(\);/);
const usePlayerBindings = usePlayerMatch
  ? usePlayerMatch[1]
      .split(',')
      .map((binding) => binding.trim())
      .filter(Boolean)
      .map((binding) => binding.split(':')[0].trim())
  : [];

const checks = [
  {
    message: "imports usePlayer from '@/context/PlayerContext'",
    pass: /import\s*\{\s*usePlayer\s*\}\s*from\s*['"]@\/context\/PlayerContext['"];?/.test(playerSource),
  },
  {
    message: 'does not create a local YouTube player engine',
    pass: !/new\s+window\.YT\.Player/.test(playerSource),
  },
  {
    message: 'does not load the YouTube iframe_api script',
    pass: !/iframe_api/.test(playerSource),
  },
  {
    message: 'uses required PlayerContext playback bindings',
    pass: requiredBindings.every((binding) => usePlayerBindings.includes(binding)),
  },
  {
    message: 'does not consume shuffle/repeat engine controls in Player UI contract',
    pass: forbiddenBindings.every((binding) => !usePlayerBindings.includes(binding)),
  },
];

const failures = checks.filter((check) => !check.pass);

if (failures.length > 0) {
  console.error('Task 2 player engine contract failed:');
  for (const failure of failures) {
    console.error(`- ${failure.message}`);
  }
  process.exit(1);
}

console.log('Task 2 player engine contract passed.');
