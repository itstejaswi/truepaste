/**
 * Extension build.
 *
 * Assembles dist/extension/ by copying the shared core into the extension
 * tree, then zips it for release. The core has exactly one home - js/core -
 * so the extension and the website can never drift apart.
 *
 *   node tools/build-extension.mjs [--zip]
 */

import { cpSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist');
const OUT = join(DIST, 'extension');

rmSync(DIST, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// The extension shell.
cpSync(join(ROOT, 'extension'), OUT, { recursive: true });

// The shared core, copied to the path the extension imports from.
cpSync(join(ROOT, 'js', 'core'), join(OUT, 'core'), { recursive: true });

// Keep the manifest version aligned with package.json.
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const manifestPath = join(OUT, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
manifest.version = pkg.version;
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Built ${OUT} (version ${pkg.version})`);

if (process.argv.includes('--zip')) {
  const zipPath = join(DIST, `trustpaste-${pkg.version}.zip`);
  // PowerShell on Windows, zip elsewhere. Both are present on GitHub runners.
  if (process.platform === 'win32') {
    execFileSync('powershell', [
      '-NoProfile',
      '-Command',
      `Compress-Archive -Path '${OUT}\\*' -DestinationPath '${zipPath}' -Force`,
    ]);
  } else {
    execFileSync('zip', ['-r', '-q', zipPath, '.'], { cwd: OUT });
  }
  const hash = createHash('sha256').update(readFileSync(zipPath)).digest('hex');
  writeFileSync(`${zipPath}.sha256`, `${hash}  trustpaste-${pkg.version}.zip\n`);
  console.log(`Packaged ${zipPath}`);
  console.log(`SHA-256  ${hash}`);
}
