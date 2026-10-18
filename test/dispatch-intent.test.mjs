import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { createController } from '../src/controller.js';
import { STEPS, createPresentationState, transitionPresentation } from '../src/state/presentation.js';
import { createManualEvent, parseCommand, commandForKey } from '../src/input/manual.js';
import { bindInputLifecycle } from '../src/input/lifecycle.js';
import { createScriptStore } from '../src/script/storage.js';

test('rejected restart preserves active inputs; accepted stop stops both inputs', async () => {
  let dispatchIntent, state, cameraActions, speechActions;
  const input = () => ({
    running: false,
    stops: 0,
    start() { this.running = true; },
    stop() { this.running = false; this.stops += 1; },
  });
  const camera = input();
  const speech = { ...input(), supported: true };
  const root = { prepend() {}, querySelector() { return {}; } };
  const document = Object.assign(new EventTarget(), {
    getElementById: () => root,
    createElement: () => ({ setAttribute() {} }),
  });
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');

  // Execute the real entry point, binding its imports below. Only browser UI and
  // sensor adapters are replaced; dispatch, command parsing and state stay real.
  runInNewContext(source.replace(/^import\s[^;]+;\r?$/gm, ''), {
    createController, STEPS, createPresentationState, transitionPresentation,
    createManualEvent, parseCommand, commandForKey, bindInputLifecycle,
    document, window: new EventTarget(),
    createScriptStore: (steps) => createScriptStore(steps, {getStorage: () => null}),
    mountScriptEditor: () => ({setState() {}}),
    mountPresentation: (_, onIntent) => {
      dispatchIntent = onIntent;
      return { render(next) { state = next; }, announce() {} };
    },
    mountCameraPanel: (_, actions) => {
      cameraActions = actions;
      return { video: {}, setState() {} };
    },
    mountSpeechPanel: (_, actions) => {
      speechActions = actions;
      return { setState() {} };
    },
    createCameraInput: () => camera,
    createSpeechInput: () => speech,
  }, { filename: 'src/main.js' });

  cameraActions.onStart();
  speechActions.onStart();
  assert.equal(state.phase, 'presenting');
  assert.equal(camera.running, true);
  assert.equal(speech.running, true);
  const presenting = state;

  dispatchIntent('COMMAND', { text: 'はじめから' });
  assert.equal(state, presenting, 'restart is rejected during the presentation');
  assert.equal(camera.running, true, 'rejected restart must keep camera active');
  assert.equal(speech.running, true, 'rejected restart must keep speech active');
  assert.equal(camera.stops, 0);
  assert.equal(speech.stops, 0);

  dispatchIntent('COMMAND', { text: '停止' });
  assert.equal(state.phase, 'stopped');
  assert.equal(camera.running, false);
  assert.equal(speech.running, false);
  assert.equal(camera.stops, 1);
  assert.equal(speech.stops, 1);
});
