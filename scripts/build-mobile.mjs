import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const webDir = resolve(root, 'www');
if (!webDir.startsWith(`${root}/`) && !webDir.startsWith(`${root}\\`)) {
  throw new Error('Refusing to write outside the project web directory.');
}
await mkdir(webDir, { recursive: true });

for (const file of [
  'index.html', 'styles.css', 'app.js', 'features.js', 'cloud-sync.js',
  'pwa.js', 'nearby-config.js', 'manifest.webmanifest'
]) {
  await cp(join(root, file), join(webDir, file));
}
for (const directory of ['assets', 'data', 'icons']) {
  await cp(join(root, directory), join(webDir, directory), { recursive: true });
}

const indexPath = join(webDir, 'index.html');
let html = await readFile(indexPath, 'utf8');
const pwaScript = '  <script src="./pwa.js?v=1.10"></script>';
if (!html.includes(pwaScript)) throw new Error('Could not find the PWA script insertion point.');
html = html.replace(pwaScript, '  <script src="./native-auth-bridge.js"></script>\n' + pwaScript);
await writeFile(indexPath, html, 'utf8');

await build({
  entryPoints: [join(root, 'scripts/mobile-auth-bridge.js')],
  outfile: join(webDir, 'native-auth-bridge.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2020']
});
