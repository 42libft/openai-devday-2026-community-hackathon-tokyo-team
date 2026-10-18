import assert from 'node:assert/strict';
import test from 'node:test';
import { createCameraInput } from '../src/input/camera.js';
import { createSpeechInput } from '../src/input/speech.js';
import { bindInputLifecycle } from '../src/input/lifecycle.js';

function harness(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const window = new EventTarget();
  const document = new EventTarget();
  document.hidden = false;
  const tracks = [], recognitions = [], requests = [], decisions = [];
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { mediaDevices: { async getUserMedia() {
      const track = new EventTarget();
      track.readyState = 'live';
      track.stopped = 0;
      track.stop = () => { track.stopped += 1; track.readyState = 'ended'; };
      tracks.push(track);
      return { getTracks: () => [track] };
    } } },
  });
  const video = {
    videoWidth: 480, videoHeight: 270, srcObject: null,
    play: async () => {}, pause() {},
    ownerDocument: { createElement: () => ({
      getContext: () => ({ drawImage() {} }),
      toDataURL: () => 'data:image/jpeg;base64,AA==',
    }) },
  };
  const getState = () => ({ phase: 'presenting', sessionEpoch: 1, revision: 0 });
  const onDecision = (event) => { decisions.push(event); return true; };
  const camera = createCameraInput({ video, getState, onDecision,
    fetchImpl: (_, options) => new Promise((resolve) => {
      const body = JSON.parse(options.body);
      requests.push({ signal: options.signal, resolve: () => resolve({
        ok: true, json: async () => ({ ...body, action: 'NEXT', confidence: 1 }),
      }) });
    }),
  });
  class Recognition {
    constructor() { this.aborted = 0; recognitions.push(this); }
    start() { this.onstart?.(); }
    abort() { this.aborted += 1; this.onend?.(); }
    say() {
      this.onspeechstart?.();
      const result = [{ transcript: '次へ', confidence: 1 }];
      result.isFinal = true;
      this.onresult?.({ resultIndex: 0, results: [result] });
    }
  }
  const speech = createSpeechInput({ Recognition, getState, onDecision, onStatus: () => {} });
  const unbind = bindInputLifecycle({ window, document, inputs: [camera, speech] });
  t.after(() => {
    unbind();
    camera.dispose();
    speech.dispose();
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
    else delete globalThis.navigator;
  });
  return { camera, speech, video, tracks, recognitions, requests, decisions,
    page(type, persisted) {
      const event = new Event(type);
      Object.defineProperty(event, 'persisted', { value: persisted });
      window.dispatchEvent(event);
    },
    visibility(hidden) {
      document.hidden = hidden;
      document.dispatchEvent(new Event('visibilitychange'));
    },
  };
}

test('bfcache departure stops inputs and requests; restore waits for explicit restart and rejects old results', async (t) => {
  const h = harness(t);
  assert.equal(await h.camera.start(), true);
  h.speech.start();
  const oldRecognition = h.recognitions[0];
  const capture = h.camera.capture();
  h.page('pagehide', true);
  assert.equal(h.tracks[0].stopped, 1);
  assert.equal(h.video.srcObject, null);
  assert.equal(h.requests[0].signal.aborted, true);
  assert.equal(await capture, false);
  assert.equal(oldRecognition.aborted, 1);

  h.page('pageshow', true);
  h.visibility(false);
  t.mock.timers.tick(4000);
  assert.equal(await h.camera.capture(), false);
  assert.equal(h.tracks.length, 1);
  assert.equal(h.recognitions.length, 1);
  assert.equal(h.requests.length, 1);

  assert.equal(await h.camera.start(), true);
  h.speech.start();
  assert.equal(h.tracks.length, 2);
  assert.equal(h.recognitions.length, 2);
  oldRecognition.say();
  h.requests[0].resolve();
  await Promise.resolve();
  assert.equal(h.decisions.length, 0);

  const freshCapture = h.camera.capture();
  h.requests[1].resolve();
  assert.equal(await freshCapture, true);
  h.recognitions[1].say();
  assert.deepEqual(h.decisions.map(({ source }) => source), ['camera', 'voice']);
});

test('ordinary page departure releases inputs permanently', async (t) => {
  const h = harness(t);
  await h.camera.start();
  h.speech.start();
  h.page('pagehide', false);
  assert.equal(h.tracks[0].stopped, 1);
  assert.equal(h.video.srcObject, null);
  assert.equal(h.recognitions[0].aborted, 1);
  assert.equal(await h.camera.start(), false);
  h.speech.start();
  t.mock.timers.tick(4000);
  assert.equal(h.tracks.length, 1);
  assert.equal(h.recognitions.length, 1);
  assert.equal(h.requests.length, 0);
});

test('hiding the page stops inputs while showing it neither stops nor restarts them', async (t) => {
  const h = harness(t);
  await h.camera.start();
  h.speech.start();
  h.visibility(false);
  assert.equal(h.tracks[0].stopped, 0);
  assert.equal(h.recognitions[0].aborted, 0);
  h.visibility(true);
  assert.equal(h.tracks[0].stopped, 1);
  assert.equal(h.recognitions[0].aborted, 1);
  h.visibility(false);
  t.mock.timers.tick(4000);
  assert.equal(h.tracks.length, 1);
  assert.equal(h.recognitions.length, 1);
  assert.equal(h.requests.length, 0);
  assert.equal(await h.camera.start(), true);
  h.speech.start();
  assert.equal(h.tracks.length, 2);
  assert.equal(h.recognitions.length, 2);
});
