import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

// SYNTHETIC INTEGRATION CHECK: canvas camera + deterministic in-page API mock.
// No real sensor, OpenAI request, credentials, server startup or deployment.
const url = process.env.APP_URL || 'http://127.0.0.1:4208/';
const origin = new URL(url).origin;
const authorizedPublicOrigin = 'https://devday-presentation-companion.vercel.app';
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname) || origin === authorizedPublicOrigin,
  'use a local preview or the explicitly authorized public origin');
const runName = `camera-browser-${new Date().toISOString().replace(/[:.]/gu, '-')}`;
const evidence = process.env.EVIDENCE_DIR
  ? resolve(process.env.EVIDENCE_DIR)
  : resolve(import.meta.dirname, '../../evidence', runName);
await mkdir(evidence, { recursive: true });
const profile = await mkdtemp(join(tmpdir(), 'camera-mock-chrome-'));
const browser = spawn(process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless', `--user-data-dir=${profile}`, '--remote-debugging-port=0',
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--disable-background-networking', '--disable-component-update', '--disable-sync',
  '--disable-features=MediaRouter,OptimizationHints',
  '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });
let stderr = '';
let launchError;
let ws;
let send;
const errors = [], networkFailures = [], blockedRequests = [], snapshots = [], assertions = [];
browser.on('error', error => { launchError = error; });
browser.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-8000); });

// Installed before any application script. Only synthetic images exist in this page.
const installMocks = `(() => {
  const originalFetch = globalThis.fetch.bind(globalThis);
  const mock = {
    synthetic: true, denyNext: false, mediaCalls: 0, requests: [], streams: [], queue: [], held: new Map(),
    plan(items) { this.queue = items.map(item => typeof item === 'string' ? {action:item} : item); },
    release(tag) { const release = this.held.get(tag); if (!release) throw new Error('No held mock response: '+tag); this.held.delete(tag); release(); },
  };
  globalThis.__cameraMock = mock;
  const getUserMedia = async constraints => {
    mock.mediaCalls += 1;
    if (constraints.audio !== false) throw new Error('Audio must remain disabled');
    if (mock.denyNext) { mock.denyNext = false; throw new DOMException('Synthetic permission denial', 'NotAllowedError'); }
    const canvas = document.createElement('canvas');
    canvas.width = 640; canvas.height = 360;
    const context = canvas.getContext('2d');
    let frame = 0;
    const draw = () => {
      context.fillStyle = '#203b55'; context.fillRect(0,0,640,360);
      context.fillStyle = '#92bce7'; context.fillRect(36+(frame++%30),74,108,108);
      context.fillStyle = '#f0f5ff'; context.font = '25px sans-serif';
      context.fillText('MOCK CAMERA', 180, 136);
      context.font = '18px sans-serif'; context.fillText('Synthetic canvas - no real sensor', 36, 265);
    };
    draw();
    const stream = canvas.captureStream(5);
    mock.streams.push(stream);
    const timer = setInterval(() => {
      if (stream.getTracks().every(track => track.readyState === 'ended')) { clearInterval(timer); return; }
      draw();
    }, 150);
    return stream;
  };
  if (!navigator.mediaDevices) Object.defineProperty(navigator, 'mediaDevices', {value:{}, configurable:true});
  Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {value:getUserMedia, configurable:true});
  globalThis.fetch = async (input, options = {}) => {
    const target = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (target.origin !== location.origin) throw new Error('External fetch prohibited in synthetic check');
    if (target.pathname !== '/api/decide') return originalFetch(input, options);
    const body = JSON.parse(options.body);
    if (options.method !== 'POST' || !body.imageDataUrl?.startsWith('data:image/jpeg;base64,')) throw new Error('Invalid synthetic frame request');
    const item = mock.queue.shift() || {action:'NONE',tag:'default-none'};
    const entry = {
      tag: item.tag || item.action, requestId: body.requestId, sessionEpoch: body.sessionEpoch,
      baseRevision: body.baseRevision, action: item.action, confidence: item.confidence ?? 0.99,
      imageType: 'image/jpeg', imageLength: body.imageDataUrl.length, responded: false,
      aborted: Boolean(options.signal?.aborted), synthetic: true,
    };
    mock.requests.push(entry);
    options.signal?.addEventListener('abort', () => { entry.aborted = true; }, {once:true});
    if (item.hold) await new Promise(resolve => { mock.held.set(entry.tag, resolve); });
    else await new Promise(resolve => setTimeout(resolve, 35));
    entry.responded = true;
    // Intentionally ignore abort for held requests to verify stale response protection.
    return new Response(JSON.stringify({
      requestId: body.requestId, sessionEpoch: body.sessionEpoch, baseRevision: body.baseRevision,
      action: entry.action, confidence: entry.confidence, latencyMs: 35,
    }), {status:200,headers:{'Content-Type':'application/json'}});
  };
})()`;

try {
  let port;
  for (let i = 0; i < 450; i++) {
    if (launchError) throw launchError;
    try { port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; }
    catch {
      if (browser.exitCode !== null || browser.signalCode) throw new Error(`Chrome exited code=${browser.exitCode} signal=${browser.signalCode}`);
      await delay(100);
    }
  }
  assert.ok(port, 'isolated browser ready');
  const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json());
  const page = pages.find(target => target.type === 'page');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, {once:true}); ws.addEventListener('error', reject, {once:true});
  });
  let sequence = 0;
  const pending = new Map();
  send = (method, params = {}) => {
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 10000);
      pending.set(id, {resolve,reject,timer}); ws.send(JSON.stringify({id,method,params}));
    });
  };
  ws.addEventListener('message', ({data}) => {
    const message = JSON.parse(data);
    if (message.id && pending.has(message.id)) {
      const request = pending.get(message.id); clearTimeout(request.timer); pending.delete(message.id);
      message.error ? request.reject(new Error(JSON.stringify(message.error))) : request.resolve(message.result);
    }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') errors.push(message.params);
    if (message.method === 'Network.loadingFailed') networkFailures.push(message.params);
    if (message.method === 'Fetch.requestPaused') {
      const {requestId,request} = message.params;
      const target = new URL(request.url);
      const blocked = /^https?:$/u.test(target.protocol) && (target.origin !== origin || target.pathname === '/api/decide');
      if (blocked) blockedRequests.push({url:request.url,method:request.method,reason:'Real API/external request prohibited'});
      void send(blocked ? 'Fetch.failRequest' : 'Fetch.continueRequest', blocked
        ? {requestId,errorReason:'BlockedByClient'} : {requestId}).catch(error => errors.push({interception:String(error)}));
    }
  });
  async function evaluate(expression) {
    const response = await send('Runtime.evaluate', {expression,returnByValue:true,awaitPromise:true});
    if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
    return response.result.value;
  }
  async function waitFor(expression, label, timeoutMs = 9000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (await evaluate(expression)) return;
      await delay(50);
    }
    throw new Error(`Timeout waiting for ${label}`);
  }
  async function click(action) {
    const point = await evaluate(`(() => {
      const button=document.querySelector('[data-camera-action="${action}"]');
      if(!button) throw new Error('Camera button missing');
      button.scrollIntoView({block:'center'});
      const rect=button.getBoundingClientRect();
      return {x:rect.x+rect.width/2,y:rect.y+rect.height/2,disabled:button.disabled,visible:rect.width>0&&rect.height>0};
    })()`);
    assert.equal(point.disabled, false, `${action} enabled`); assert.equal(point.visible, true, `${action} visible`);
    for (const type of ['mousePressed','mouseReleased']) await send('Input.dispatchMouseEvent', {type,x:point.x,y:point.y,button:'left',clickCount:1});
  }
  async function snapshot(label) {
    const state = await evaluate(`(() => ({
      mock:true,phase:document.querySelector('#app').dataset.phase,step:Number(document.querySelector('#app').dataset.step),
      revision:Number(document.querySelector('#app').dataset.revision),
      cameraStatus:document.querySelector('.camera-panel').dataset.cameraStatus,
      message:document.querySelector('.camera-live-status').textContent,
      action:document.querySelector('[data-camera-metric="action"]').textContent,
      confidence:document.querySelector('[data-camera-metric="confidence"]').textContent,
      latency:document.querySelector('[data-camera-metric="latency"]').textContent,
      startDisabled:document.querySelector('[data-camera-action="start"]').disabled,
      stopDisabled:document.querySelector('[data-camera-action="stop"]').disabled,
      captureDisabled:document.querySelector('[data-camera-action="capture"]').disabled,
      videoAttached:Boolean(document.querySelector('.camera-preview video').srcObject),
      mediaCalls:__cameraMock.mediaCalls,requests:__cameraMock.requests.map(request=>({...request})),
      tracks:__cameraMock.streams.flatMap(stream=>stream.getTracks().map(track=>track.readyState)),
      width:innerWidth,scrollWidth:document.documentElement.scrollWidth,
    }))()`);
    assert.ok(state.scrollWidth <= state.width, `${label}: no horizontal overflow`);
    snapshots.push({label,...state}); return state;
  }
  async function screenshot(label) {
    await evaluate('window.scrollTo(0,0)');
    const metrics = await send('Page.getLayoutMetrics');
    const result = await send('Page.captureScreenshot', {format:'png',captureBeyondViewport:true,
      clip:{x:0,y:0,width:metrics.cssContentSize.width,height:metrics.cssContentSize.height,scale:1}});
    await writeFile(join(evidence, `camera-browser-${label}.png`), Buffer.from(result.data,'base64'));
  }
  const plan = items => evaluate(`__cameraMock.plan(${JSON.stringify(items)})`);
  const responded = tag => waitFor(`__cameraMock.requests.some(request=>request.tag===${JSON.stringify(tag)}&&request.responded)`, tag);
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
  await send('Fetch.enable', {patterns:[{urlPattern:'*',requestStage:'Request'}]});
  await send('Page.addScriptToEvaluateOnNewDocument', {source:installMocks});

  for (const viewport of [{label:'desktop',width:1440,height:1000},{label:'mobile',width:390,height:844}]) {
    await send('Emulation.setDeviceMetricsOverride', {width:viewport.width,height:viewport.height,deviceScaleFactor:1,mobile:viewport.label==='mobile'});
    await send('Page.navigate', {url});
    await waitFor(`Boolean(document.querySelector('.camera-panel')&&document.querySelector('#app')?.dataset.phase&&globalThis.__cameraMock)`, 'camera UI mount');
    const initial = await snapshot(`${viewport.label}:idle`);
    assert.equal(initial.phase, 'idle'); assert.equal(initial.mediaCalls, 0); assert.equal(initial.requests.length, 0);
    assert.equal(initial.stopDisabled, false); assert.equal(initial.action, '—');
    await screenshot(`${viewport.label}-mock-idle`);
    await plan([{action:'NEXT',tag:'first-next'},{action:'NEXT',tag:'held-next'},{action:'NONE',tag:'rearm'},{action:'PREVIOUS',tag:'previous'}]);
    await click('start');
    await responded('first-next');
    await waitFor(`Number(document.querySelector('#app').dataset.step)===1`, 'first NEXT applies');
    const first = await snapshot(`${viewport.label}:first-next`);
    assert.equal(first.phase,'presenting'); assert.equal(first.cameraStatus,'result'); assert.equal(first.action,'次へ');
    assert.equal(first.startDisabled,true); assert.equal(first.captureDisabled,false);
    await responded('held-next');
    const held = await snapshot(`${viewport.label}:held-next`);
    assert.equal(held.step,1); assert.equal(held.revision,first.revision); assert.match(held.message,/同じ合図|連続/);
    await responded('rearm');
    const rearmed = await snapshot(`${viewport.label}:rearmed`);
    assert.equal(rearmed.step,1); assert.equal(rearmed.revision,first.revision);
    await responded('previous');
    await waitFor(`Number(document.querySelector('#app').dataset.step)===0`, 'PREVIOUS after NONE');
    const previous = await snapshot(`${viewport.label}:previous`);
    assert.equal(previous.revision,first.revision+1); assert.equal(previous.action,'前へ');
    await screenshot(`${viewport.label}-mock-gesture`);
    assertions.push({viewport:viewport.label,check:'NEXT once, held NEXT suppressed, NONE rearms, PREVIOUS applies',passed:true,mock:true});

    await plan([{action:'NONE',tag:'before-late'}]); await click('capture'); await responded('before-late');
    await plan([{action:'NEXT',tag:'late-next',hold:true}]); await click('capture');
    await waitFor(`__cameraMock.held.has('late-next')`, 'held late result');
    const pendingResult = await snapshot(`${viewport.label}:request-pending`);
    assert.equal(pendingResult.cameraStatus,'judging'); assert.equal(pendingResult.captureDisabled,true);
    await click('stop');
    const stopped = await snapshot(`${viewport.label}:camera-stopped`);
    assert.equal(stopped.cameraStatus,'stopped'); assert.equal(stopped.videoAttached,false);
    assert.ok(stopped.tracks.every(state=>state==='ended'),'all synthetic tracks stopped');
    assert.equal(stopped.requests.find(request=>request.tag==='late-next').aborted,true);
    await evaluate(`__cameraMock.release('late-next')`); await responded('late-next'); await delay(2200);
    const late = await snapshot(`${viewport.label}:late-result-ignored`);
    assert.equal(late.revision,stopped.revision); assert.equal(late.step,stopped.step);
    assert.equal(late.cameraStatus,'stopped'); assert.equal(late.requests.length,stopped.requests.length);
    assertions.push({viewport:viewport.label,check:'Stop aborts, releases tracks, ignores late response and prevents rescheduling',passed:true,mock:true});

    await evaluate('__cameraMock.denyNext=true'); await click('start');
    await waitFor(`document.querySelector('.camera-panel').dataset.cameraStatus==='error'`, 'synthetic permission denial');
    const denied = await snapshot(`${viewport.label}:permission-denied`);
    assert.equal(denied.startDisabled,false); assert.equal(denied.stopDisabled,false);
    assert.equal(denied.requests.length,late.requests.length); assert.match(denied.message,/許可|開始できません/);
    await screenshot(`${viewport.label}-mock-denied`);
    await plan([{action:'NEXT',tag:'recovery-next'}]); await click('start'); await responded('recovery-next');
    await waitFor(`Number(document.querySelector('#app').dataset.step)===1`, 'recovered NEXT');
    const recovered = await snapshot(`${viewport.label}:permission-recovered`);
    assert.equal(recovered.cameraStatus,'result'); assert.equal(recovered.mediaCalls,3);
    await screenshot(`${viewport.label}-mock-recovered`);
    await click('stop'); await snapshot(`${viewport.label}:final-stopped`);
    assertions.push({viewport:viewport.label,check:'Denied permission recovers on explicit restart; no horizontal overflow',passed:true,mock:true});
  }
  assert.deepEqual(errors,[],'no browser JavaScript errors');
  assert.deepEqual(networkFailures,[],'no network loading failures');
  assert.deepEqual(blockedRequests,[],'application attempted no real API or external requests');
  const result = {passed:true,mock:true,checkedAt:new Date().toISOString(),url,realSensors:false,realApi:false,
    mockDescription:'canvas.captureStream camera and deterministic request-identity echo API responses; abort-ignoring late response included',
    viewports:2,assertions,snapshots,errors,networkFailures,blockedRequests};
  await writeFile(join(evidence,'camera-browser-result.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify({passed:true,mock:true,viewports:2,checks:assertions.length,snapshots:snapshots.length,evidence,realSensors:false,realApi:false}));
} catch (error) {
  await writeFile(join(evidence,'camera-browser-failure.json'),JSON.stringify({passed:false,mock:true,error:String(error),snapshots,assertions,errors,networkFailures,blockedRequests,stderr,realSensors:false,realApi:false},null,2));
  console.error(String(error)); console.error(`Synthetic evidence: ${evidence}`); process.exitCode=1;
} finally {
  ws?.close();
  if (browser.exitCode===null) browser.kill('SIGTERM');
}
