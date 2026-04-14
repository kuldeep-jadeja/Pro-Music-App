import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const playerFilePath = path.resolve(scriptDir, '..', '..', 'components', 'Player.js');
const playerSource = readFileSync(playerFilePath, 'utf8');

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
