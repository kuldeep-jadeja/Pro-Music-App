import fs from 'node:fs';

const src = fs.readFileSync('models/Track.js', 'utf8');
const checks = [
    ['genres field', /genres:\s*\{\s*type:\s*\[String\]/.test(src)],
    ['primaryGenre field', /primaryGenre:\s*\{\s*type:\s*String/.test(src)],
    [
        'metadataStatus enum',
        /metadataStatus:\s*\{[\s\S]*enum:\s*\['pending',\s*'partial',\s*'complete',\s*'failed'\]/.test(src),
    ],
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
