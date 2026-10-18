import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createServer, preview } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));

async function assertPage(base) {
  const response = await fetch(base);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/html/);
  const html = await response.text();
  assert.match(html, /data-smoke="team-workspace"/);
  assert.match(html, /id="app"/);
  assert.match(html, /手の合図でスライド操作/);
  assert.match(html, /カメラ開始後だけ静止画をOpenAIへ送信/);
  const paths = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(paths.some((path) => path.endsWith('.js')), 'JavaScript asset');
  assert.ok(paths.some((path) => path.endsWith('.css')), 'CSS asset');
  const assets = [];
  for (const path of paths) {
    const url = new URL(path, base);
    assert.equal(url.origin, new URL(base).origin);
    const asset = await fetch(url, {
      headers: { Accept: path.endsWith('.css') ? 'text/css' : 'text/javascript' },
    });
    assert.equal(asset.status, 200, path);
    const text = await asset.text();
    assert.ok(text.length > 0, path);
    if (path.endsWith('.css')) assert.match(asset.headers.get('content-type'), /text\/css/);
    if (path.endsWith('.js')) assert.match(asset.headers.get('content-type'), /javascript/);
    assets.push({ path, text });
  }
  const missing = await fetch(new URL('missing-smoke-asset.js', base));
  assert.equal(missing.status, 404);
  const api = await fetch(new URL('api/decide', base));
  assert.equal(api.status, 405, 'local API is mounted and rejects GET without a model call');
  const invalid = await fetch(new URL('api/decide', base), {
    method:'POST', headers:{'Content-Type':'application/json'}, body:'{}',
  });
  assert.equal(invalid.status, 400, 'invalid images are rejected before API access');
  return assets;
}

test('development server serves the page and its local assets', async () => {
  const server = await createServer({
    root,
    server: { host: '127.0.0.1', port: 0, strictPort: false },
  });
  try {
    await server.listen();
    const port = server.httpServer.address().port;
    await assertPage(`http://127.0.0.1:${port}/`);
  } finally {
    await server.close();
  }
});

test('built static output serves the app and local assets', async () => {
  const server = await preview({
    root,
    preview: { host: '127.0.0.1', port: 0, strictPort: false },
  });
  try {
    const port = server.httpServer.address().port;
    await assertPage(`http://127.0.0.1:${port}/`);
  } finally {
    await new Promise((resolve, reject) =>
      server.httpServer.close((error) => error ? reject(error) : resolve()));
  }
});
