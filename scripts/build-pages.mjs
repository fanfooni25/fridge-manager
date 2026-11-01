import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const siteDir = resolve(root, 'site');
if (!siteDir.startsWith(`${root}/`) && !siteDir.startsWith(`${root}\\`)) {
  throw new Error('Refusing to write outside the project site directory.');
}

await rm(siteDir, { recursive: true, force: true });
await mkdir(siteDir, { recursive: true });

for (const file of [
  'index.html', 'styles.css', 'app.js', 'features.js', 'cloud-sync.js',
  'pwa.js', 'sw.js', 'nearby-config.js', 'manifest.webmanifest'
]) {
  await cp(join(root, file), join(siteDir, file));
}
for (const directory of ['assets', 'data', 'icons']) {
  await cp(join(root, directory), join(siteDir, directory), { recursive: true });
}
await writeFile(join(siteDir, '.nojekyll'), '', 'utf8');
