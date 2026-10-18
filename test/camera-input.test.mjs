import assert from 'node:assert/strict';
import test from 'node:test';
import { CameraDecisionGate, createCameraInput, validateCameraDecision } from '../src/input/camera.js';

const state = { phase: 'presenting', sessionEpoch: 2, revision: 4 };
const request = { requestId: 'frame-1', sessionEpoch: 2, baseRevision: 4 };
const result = { ...request, action: 'NEXT', confidence: 0.95 };

test('camera response requires matching identity, epoch, revision and finite confidence', () => {
  assert.equal(validateCameraDecision(result, request, state), 'valid');
  for (const patch of [
    { requestId: 'another' }, { sessionEpoch: 1 }, { baseRevision: 3 },
    { action: 'STOP' }, { confidence: NaN }, { confidence: Infinity },
    { confidence: '0.95' }, { confidence: -1 }, { confidence: 1.1 },
  ]) assert.equal(validateCameraDecision({ ...result, ...patch }, request, state), 'invalid');
  for (const patch of [{ revision: 5 }, { sessionEpoch: 3 }, { phase: 'stopped' }, { pendingJump: { targetStep: 1 } }]) {
    assert.equal(validateCameraDecision(result, request, { ...state, ...patch }), 'stale');
  }
});

test('held gestures, duplicates and uncertain NONE cannot repeat an action; confident NONE rearms', () => {
  const gate = new CameraDecisionGate();
  gate.start();
  assert.deepEqual(gate.consume(result, request, state).event, {
    type: 'NEXT', source: 'camera', eventId: 'frame-1', sessionEpoch: 2, baseRevision: 4,
  });
  assert.equal(gate.consume(result, request, state).kind, 'duplicate');
  let id = 1;
  const consume = (action, confidence = 0.95) => {
    const next = { ...request, requestId: `frame-${++id}` };
    return gate.consume({ ...next, action, confidence }, next, state);
  };
  assert.equal(consume('PREVIOUS').kind, 'held');
  assert.equal(consume('NONE', 0.89).kind, 'uncertain');
  assert.equal(consume('NEXT').kind, 'held');
  assert.equal(consume('NONE', 0.9).kind, 'none');
  assert.equal(consume('PREVIOUS', 0.9).kind, 'action');
  gate.stop();
  assert.equal(consume('NONE').kind, 'stopped');
  assert.equal(consume('NEXT').kind, 'stopped');
});

test('stale NONE cannot rearm a held gesture', () => {
  const gate = new CameraDecisionGate();
  gate.start();
  gate.consume(result, request, state);
  const next = { ...request, requestId: 'frame-2' };
  assert.equal(gate.consume({ ...next, action: 'NONE', confidence: 1 }, next, { ...state, revision: 5 }).kind, 'stale');
  assert.equal(gate.consume({ ...next, action: 'NEXT', confidence: 1 }, next, state).kind, 'held');
});

function harness(t, { getMedia, fetchImpl } = {}) {
  const track = new EventTarget();
  track.readyState = 'live';
  track.stopped = 0;
  track.stop = () => { track.stopped += 1; track.readyState = 'ended'; };
  const stream = { getTracks: () => [track] };
  const media = { getUserMedia: getMedia ?? (async () => stream) };
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: media } });
  t.after(() => original ? Object.defineProperty(globalThis, 'navigator', original) : delete globalThis.navigator);
  const frames = [];
  const video = {
    videoWidth: 1280, videoHeight: 720, srcObject: null,
    play: async () => {}, pause() {},
    ownerDocument: { createElement() {
      const canvas = { width: 0, height: 0, getContext: () => ({ drawImage() {} }),
        toDataURL(type, quality) { frames.push({ width: canvas.width, height: canvas.height, type, quality }); return 'data:image/jpeg;base64,AA=='; } };
      return canvas;
    } },
  };
  let current = { ...state };
  const events = [];
  const statuses = [];
  const camera = createCameraInput({ video, getState: () => current,
    onDecision: (event) => events.push(event), onStatus: (status) => statuses.push(status), fetchImpl });
  t.after(() => camera.dispose());
  return { camera, video, track, stream, events, frames, statuses, setState: (value) => { current = value; } };
}

test('one request at a time, captured state stays fixed, stopped requests never dispatch', async (t) => {
  let resolveFetch;
  const calls = [];
  const h = harness(t, { fetchImpl: (url, options) => {
    calls.push({ url, ...options });
    return new Promise((resolve) => { resolveFetch = resolve; });
  } });
  assert.equal(calls.length, 0);
  await h.camera.start();
  const capture = h.camera.capture();
  assert.equal(await h.camera.capture(), false);
  assert.equal(calls.length, 1);
  assert.deepEqual(h.frames[0], { width: 480, height: 270, type: 'image/jpeg', quality: 0.65 });
  const body = JSON.parse(calls[0].body);
  h.setState({ ...state, revision: 8 });
  assert.equal(body.baseRevision, 4);
  h.camera.stop();
  assert.equal(h.track.stopped, 1);
  assert.equal(h.video.srcObject, null);
  assert.equal(calls[0].signal.aborted, true);
  assert.equal(await capture, false);
  resolveFetch({ ok: true, json: async () => ({ ...body, action: 'NEXT', confidence: 1 }) });
  await Promise.resolve();
  assert.equal(h.events.length, 0);
});

test('stop while permission is pending releases late camera tracks without starting capture', async (t) => {
  let resolveMedia;
  const h = harness(t, { getMedia: () => new Promise((resolve) => { resolveMedia = resolve; }),
    fetchImpl: () => assert.fail('no frames before permission') });
  const start = h.camera.start();
  h.camera.stop();
  resolveMedia(h.stream);
  assert.equal(await start, false);
  assert.equal(h.track.stopped, 1);
  assert.equal(h.video.srcObject, null);
});

test('inactive presentation never sends and ended tracks release the stream', async (t) => {
  const h = harness(t, { fetchImpl: () => assert.fail('not presenting') });
  await h.camera.start();
  h.setState({ ...state, pendingJump: { targetStep: 1 } });
  assert.equal(await h.camera.capture(), false);
  h.setState({ ...state, phase: 'stopped' });
  assert.equal(await h.camera.capture(), false);
  h.track.dispatchEvent(new Event('ended'));
  assert.equal(h.track.stopped, 1);
  assert.equal(h.video.srcObject, null);
  assert.equal(h.statuses.at(-1).status, 'error');
});

test('permission rejection produces a recovery message without sending images', async (t) => {
  const h = harness(t, { getMedia: async () => { throw new Error('denied'); },
    fetchImpl: () => assert.fail('denied') });
  assert.equal(await h.camera.start(), false);
  assert.equal(h.statuses.at(-1).status, 'error');
  assert.match(h.statuses.at(-1).message, /許可/);
});

test('timeout aborts even a non-cooperating fetch and releases camera tracks', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let signal;
  const h = harness(t, { fetchImpl: (_, options) => {
    signal = options.signal;
    return new Promise(() => {});
  } });
  await h.camera.start();
  const capture = h.camera.capture();
  t.mock.timers.tick(12000);
  assert.equal(await capture, false);
  assert.equal(signal.aborted, true);
  assert.equal(h.track.stopped, 1);
  assert.equal(h.statuses.at(-1).status, 'error');
  assert.match(h.statuses.at(-1).message, /時間切れ/);
});

test('a response for an earlier presentation revision cannot move the slide', async (t) => {
  let resolveFetch;
  let body;
  const h = harness(t, { fetchImpl: (_, options) => {
    body = JSON.parse(options.body);
    return new Promise((resolve) => { resolveFetch = resolve; });
  } });
  await h.camera.start();
  const capture = h.camera.capture();
  h.setState({ ...state, revision: state.revision + 1 });
  resolveFetch({ ok: true, json: async () => ({ ...body, action: 'NEXT', confidence: 1 }) });
  assert.equal(await capture, false);
  assert.equal(h.events.length, 0);
});

test('HTTP failures show only safe recovery text and release the camera', async (t) => {
  for (const [status, code, expected] of [
    [503, 'NOT_CONFIGURED', /準備待ち/],
    [503, 'UPSTREAM_AUTH', /認証/],
    [429, 'RATE_LIMITED', /1分待って/],
    [429, 'UPSTREAM_RATE_LIMIT', /1分待って/],
    [504, 'TIMEOUT', /時間切れ/],
    [502, 'UNTRUSTED', /通信とカメラ/],
  ]) {
    await t.test(code, async (subtest) => {
      const h = harness(subtest, { fetchImpl: async () => ({
        ok: false, status, json: async () => ({ error: { code, message: 'RAW_SECRET_DO_NOT_DISPLAY' } }),
      }) });
      await h.camera.start();
      assert.equal(await h.camera.capture(), false);
      assert.equal(h.track.stopped, 1);
      assert.equal(h.statuses.at(-1).status, 'error');
      assert.match(h.statuses.at(-1).message, expected);
      assert.equal(h.statuses.some(({ message }) => message.includes('RAW_SECRET')), false);
      assert.equal(h.events.length, 0);
    });
  }
});
