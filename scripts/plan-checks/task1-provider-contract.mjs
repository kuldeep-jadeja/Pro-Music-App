import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appFilePath = path.resolve(scriptDir, '..', '..', 'pages', '_app.js');
const appSource = readFileSync(appFilePath, 'utf8');

const checks = [
  {
    message: "imports PlayerProvider from '@/context/PlayerContext'",
    pass: /import\s*\{\s*PlayerProvider\s*\}\s*from\s*['\"]@\/context\/PlayerContext['\"];?/.test(appSource),
  },
  {
    message: "imports GlobalPlayer from '@/components/GlobalPlayer'",
    pass: /import\s+GlobalPlayer\s+from\s+['\"]@\/components\/GlobalPlayer['\"];?/.test(appSource),
  },
  {
    message: 'wraps AppProvider in PlayerProvider',
    pass: /<PlayerProvider>[\s\S]*<AppProvider>[\s\S]*<\/AppProvider>[\s\S]*<\/PlayerProvider>/.test(appSource),
  },
  {
    message: 'renders GlobalPlayer once',
    pass: (appSource.match(/<GlobalPlayer\b/g) || []).length === 1,
  },
  {
    message: 'renders GlobalPlayer under providers',
    pass: /<AppProvider>[\s\S]*<GlobalPlayer\s*\/>[\s\S]*<\/AppProvider>/.test(appSource),
  },
];

const failures = checks.filter((check) => !check.pass);

if (failures.length > 0) {
  console.error('Task 1 provider contract failed:');
  for (const failure of failures) {
    console.error(`- ${failure.message}`);
  }
  process.exit(1);
}

console.log('Task 1 provider contract passed.');