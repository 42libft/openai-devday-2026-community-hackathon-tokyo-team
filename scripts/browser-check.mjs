import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { DEMO_ITEMS } from '../src/state/presentation.js';

// A fresh, isolated browser profile. This never opens the user's normal profile.
const url = process.env.APP_URL || 'http://127.0.0.1:4208/';
const evidence = process.env.EVIDENCE_DIR ? resolve(process.env.EVIDENCE_DIR) : await mkdtemp(join(tmpdir(), 'presenter-evidence-'));
await mkdir(evidence, { recursive: true });
const profile = await mkdtemp(join(tmpdir(), 'presenter-chrome-'));
const browser = spawn(process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless', `--user-data-dir=${profile}`, '--remote-debugging-port=0',
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--disable-background-networking', '--disable-component-update', '--disable-sync',
  '--disable-features=MediaRouter,OptimizationHints', 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });
let stderr = '';
let launchError;
browser.on('error', (error) => { launchError = error; });
browser.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-8000); });
let ws;
const errors = [], failures = [], snapshots = [], externalRequests = [];

try {
  let port;
  for (let i = 0; i < 150; i++) {
    if (launchError) throw launchError;
    try { port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; }
    catch { if (browser.exitCode !== null) throw new Error(`Chrome exited ${browser.exitCode}`); await delay(100); }
  }
  assert.ok(port, 'dedicated browser is ready');
  const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
  const page = pages.find((target) => target.type === 'page');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  let sequence = 0;
  const pending = new Map();
  ws.addEventListener('message', ({ data }) => {
    const result = JSON.parse(data);
    if (result.id && pending.has(result.id)) {
      const request = pending.get(result.id);
      clearTimeout(request.timer); pending.delete(result.id);
      result.error ? request.reject(new Error(JSON.stringify(result.error))) : request.resolve(result.result);
    }
    if (result.method === 'Runtime.exceptionThrown') errors.push(result.params.exceptionDetails);
    if (result.method === 'Runtime.consoleAPICalled' && result.params.type === 'error') errors.push(result.params);
    if (result.method === 'Network.loadingFailed') failures.push(result.params);
    if (result.method === 'Network.requestWillBeSent') {
      const requestUrl = result.params.request.url;
      if (/^https?:/u.test(requestUrl) && new URL(requestUrl).origin !== new URL(url).origin) externalRequests.push(requestUrl);
    }
  });
  function send(method, params = {}) {
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 8000);
      pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async function evaluate(expression) {
    const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
    return response.result.value;
  }
  async function click(selector) {
    const point = await evaluate(`(() => {
      const b=document.querySelector(${JSON.stringify(selector)});
      if(!b) throw new Error('Button missing');
      b.scrollIntoView({block:'center'});
      const r=b.getBoundingClientRect();
      return {x:r.x+r.width/2,y:r.y+r.height/2,disabled:b.disabled,visible:r.width>0&&r.height>0};
    })()`);
    assert.equal(point.disabled, false, selector);
    assert.equal(point.visible, true, selector);
    for (const type of ['mousePressed', 'mouseReleased']) {
      await send('Input.dispatchMouseEvent', { type, x: point.x, y: point.y, button: 'left', clickCount: 1 });
    }
  }
  async function fill(selector, value) {
    await evaluate(`(() => {const e=document.querySelector(${JSON.stringify(selector)});e.focus();e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  }
  const submit = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)}).requestSubmit()`);
  async function snapshot(label) {
    const state = await evaluate(`(() => ({
      phase:document.querySelector('#app').dataset.phase,
      revision:Number(document.querySelector('#app').dataset.revision),
      step:Number(document.querySelector('#app').dataset.step),
      title:document.querySelector('#slide-title').textContent,
      query:document.querySelector('#search-query').value,
      results:[...document.querySelectorAll('[data-result-id]')].filter(e=>e.getClientRects().length).map(e=>e.dataset.resultId),
      selected:document.querySelector('[data-result-id][aria-pressed="true"]')?.dataset.resultId || null,
      status:document.querySelector('#demo-status').textContent,
      width:innerWidth,scrollWidth:document.documentElement.scrollWidth,
    }))()`);
    assert.ok(state.scrollWidth <= state.width, `${label}: no horizontal overflow`);
    snapshots.push({ label, ...state });
    return state;
  }
  const frame = ({ step, title, query, results, selected }) => ({ step, title, query, results, selected });
  async function screenshot(name) {
    await evaluate('window.scrollTo(0,0)');
    const metrics = await send('Page.getLayoutMetrics');
    const shot = await send('Page.captureScreenshot', {
      format: 'png', captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: metrics.cssContentSize.width, height: metrics.cssContentSize.height, scale: 1 },
    });
    await writeFile(join(evidence, `${name}.png`), Buffer.from(shot.data, 'base64'));
  }
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
  for (const viewport of [{ label: 'desktop', width: 1440, height: 1000 }, { label: 'mobile', width: 390, height: 844 }]) {
    await send('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.label === 'mobile' });
    await send('Page.navigate', { url });
    let loaded;
    for (let i = 0; i < 100; i++) {
      loaded = await evaluate(`Boolean(document.querySelector('#app')?.dataset.phase)`);
      if (loaded) break;
      await delay(50);
    }
    assert.ok(loaded, 'app mounted');
    assert.equal((await snapshot(`${viewport.label}:idle`)).phase, 'idle');
    await screenshot(`${viewport.label}-idle`);
    await click('[data-event="START"]');
    const start = await snapshot(`${viewport.label}:started`);
    await click('[data-event="NEXT"]');
    assert.equal((await snapshot(`${viewport.label}:next`)).step, 1);
    await click('[data-event="UNDO"]');
    assert.deepEqual(frame(await snapshot(`${viewport.label}:undo`)), frame(start));
    await click('[data-event="NEXT"]');
    await fill('#search-query', DEMO_ITEMS[0].title);
    const beforeKey = await snapshot(`${viewport.label}:typing`);
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
    assert.equal((await snapshot(`${viewport.label}:input-key`)).revision, beforeKey.revision);
    await submit('#search-form');
    await click(`[data-result-id="${DEMO_ITEMS[0].id}"]`);
    const original = await snapshot(`${viewport.label}:selected`);
    assert.equal(original.selected, DEMO_ITEMS[0].id);
    assert.deepEqual(original.results, [DEMO_ITEMS[0].id]);
    await click('[data-step-target="0"]');
    assert.deepEqual(frame(await snapshot(`${viewport.label}:candidate`)), frame(original));
    await click('[data-event="CANCEL_JUMP"]');
    assert.deepEqual(frame(await snapshot(`${viewport.label}:cancelled`)), frame(original));
    await click('[data-step-target="0"]');
    await click('[data-event="CONFIRM_JUMP"]');
    assert.equal((await snapshot(`${viewport.label}:detour`)).step, 0);
    await fill('#search-query', DEMO_ITEMS[1].title);
    await submit('#search-form');
    await click(`[data-result-id="${DEMO_ITEMS[1].id}"]`);
    await click('[data-event="NEXT"]');
    await click('[data-event="RESUME"]');
    assert.deepEqual(frame(await snapshot(`${viewport.label}:restored`)), frame(original));
    await screenshot(`${viewport.label}-restored`);
    await fill('#command-text', '次の機能について説明します');
    const beforeUnknown = await snapshot(`${viewport.label}:unknown-before`);
    await submit('#command-form');
    const unknown = await snapshot(`${viewport.label}:unknown`);
    assert.equal(unknown.revision, beforeUnknown.revision);
    assert.match(unknown.status, /対応|見つかりません/);
    await fill('#search-query', 'zzzz該当なし');
    await submit('#search-form');
    assert.deepEqual((await snapshot(`${viewport.label}:empty-results`)).results, []);
    await click('[data-event="UNDO"]');
    assert.deepEqual(frame(await snapshot(`${viewport.label}:search-undo`)), frame(original));
    await click('[data-event="STOP"]');
    const stopped = await snapshot(`${viewport.label}:stopped`);
    assert.equal(stopped.phase, 'stopped');
    assert.deepEqual(frame(stopped), frame(original));
    await evaluate('document.activeElement?.blur()');
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
    assert.equal((await snapshot(`${viewport.label}:stopped-key`)).revision, stopped.revision);
    await click('[data-event="RESTART"]');
    assert.equal((await snapshot(`${viewport.label}:restart`)).phase, 'idle');
  }
  assert.deepEqual(errors, [], 'no browser JavaScript errors');
  assert.deepEqual(failures, [], 'no network loading failures');
  assert.deepEqual(externalRequests, [], 'no external application requests');
  await writeFile(join(evidence, 'browser-result.json'), JSON.stringify({ passed: true, checkedAt: new Date().toISOString(), url, snapshots, errors, failures, externalRequests, realSensors: false }, null, 2));
  console.log(JSON.stringify({ passed: true, viewports: 2, snapshots: snapshots.length, errors: errors.length, failures: failures.length, externalRequests: externalRequests.length, evidence }));
} catch (error) {
  await writeFile(join(evidence, 'browser-failure.json'), JSON.stringify({ error: String(error), snapshots, errors, failures, externalRequests, stderr }, null, 2));
  console.error(String(error)); process.exitCode = 1;
} finally {
  ws?.close();
  if (browser.exitCode === null) browser.kill('SIGTERM');
}
