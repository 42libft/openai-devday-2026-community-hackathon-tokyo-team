import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Read-only check: inspect the entry assets actually referenced by the release.
// No camera, microphone, application API, authentication or deployment is used.
const target = process.argv[2] ?? new URL('../dist/index.html', import.meta.url).href;
const entry = /^https?:\/\//u.test(target) || target.startsWith('file:')
  ? new URL(target)
  : pathToFileURL(resolve(target.endsWith('.html') ? target : `${target}/index.html`));
if (entry.protocol !== 'file:' && !['http:', 'https:'].includes(entry.protocol)) {
  throw new Error('Use a local build directory or an HTTP(S) page URL.');
}
if (entry.username || entry.password || entry.search) throw new Error('Use a public URL without credentials or query parameters.');

async function read(url) {
  if (url.protocol === 'file:') return readFile(fileURLToPath(url), 'utf8');
  const response = await fetch(url, { headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`${response.status} reading ${url.pathname}`);
  return response.text();
}

try {
  const html = await read(entry);
  const assets = [...html.matchAll(/<(script|link)\b[^>]*>/giu)].flatMap(([tag, kind]) => {
    const ref = /\b(?:src|href)\s*=\s*["']([^"']+)["']/iu.exec(tag)?.[1];
    if (!ref) return [];
    if (kind.toLowerCase() === 'link' && !/\brel\s*=\s*["']stylesheet["']/iu.test(tag)) return [];
    const url = new URL(ref, entry);
    // Third-party analytics cannot establish that application code was released.
    if (url.protocol !== entry.protocol || url.origin !== entry.origin) return [];
    if (entry.protocol === 'file:' && !fileURLToPath(url).startsWith(`${dirname(fileURLToPath(entry))}/`)) return [];
    return [{ kind: kind.toLowerCase(), url }];
  });
  const loaded = await Promise.all(assets.map(async asset => ({ ...asset, content: await read(asset.url) })));
  const scripts = loaded.filter(asset => asset.kind === 'script').map(asset => asset.content).join('\n');
  const styles = loaded.filter(asset => asset.kind === 'link').map(asset => asset.content).join('\n');
  const checks = {
    fullscreenButton: scripts.includes('FULLSCREEN_PROJECTION'),
    projectionSurface: scripts.includes('projection-shell'),
    nativeFullscreen: scripts.includes('requestFullscreen'),
    projectionStyles: styles.includes('.projection-shell'),
  };
  const passed = Object.values(checks).every(Boolean);
  console.log(JSON.stringify({ passed, target: entry.href, checks,
    assets: loaded.map(asset => asset.url.pathname), checkedAt: new Date().toISOString() }, null, 2));
  if (!passed) {
    console.error('Projection/fullscreen code is missing from this release. Deploy the tested build after the release freeze ends; merging alone does not prove the public page was updated.');
    process.exitCode = 1;
  }
} catch (error) {
  console.error(`Projection release check failed: ${error.message}`);
  process.exitCode = 1;
}
