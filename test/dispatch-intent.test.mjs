import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { createController } from '../src/controller.js';
import { STEPS, createPresentationState, transitionPresentation } from '../src/state/presentation.js';
import { createManualEvent, parseCommand, commandForKey } from '../src/input/manual.js';
import { bindInputLifecycle } from '../src/input/lifecycle.js';
import { createScriptStore } from '../src/script/storage.js';
import { createUploadSession } from '../src/slides/upload.js';

async function harness() {
  let dispatchIntent, state, cameraActions, speechActions, cameraInput, speechInput, inputSettingsActions;
  const cameraStates=[],speechStates=[],inputModes=[],inputPhases=[],inputResults=[];
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
    querySelector: () => ({}),
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
    mountInputSettings: (_, actions) => {
      inputSettingsActions = actions;
      return {cameraContainer: {}, speechContainer: {}, showPresentation() {}, setStatus() {}, setMode(mode) {inputModes.push(mode);}, setState(state) {inputPhases.push(state.phase);}, setResult(source,message) {inputResults.push({source,message});}};
    },
    mountDeckUpload: () => ({setState() {}}), createUploadSession,
    loadSlideDeck: async () => { throw new Error('No file in sensor tests'); },
    createSlidePresenter: () => ({show() {}, destroy() {}}),
    mountProjection: () => ({open() {}, render() {}}),
    mountPresentation: (_, onIntent) => {
      dispatchIntent = onIntent;
      return { render(next) { state = next; }, announce() {} };
    },
    mountCameraPanel: (_, actions) => {
      cameraActions = actions;
      return { video: {}, setState(s) {cameraStates.push(s);} };
    },
    mountSpeechPanel: (_, actions) => {
      speechActions = actions;
      return { setState(s) {speechStates.push(s);} };
    },
    createCameraInput: options => {cameraInput=options;return camera;},
    createSpeechInput: options => {speechInput=options;return speech;},
  }, { filename: 'src/main.js' });

  return {camera,speech,cameraActions,speechActions,cameraInput,speechInput,inputSettingsActions,cameraStates,speechStates,inputModes,inputPhases,inputResults,dispatchIntent,get state(){return state;}};
}

test('input mode switching is exclusive; rejected restart keeps the selected mode running', async () => {
  const h=await harness();
  h.cameraActions.onStart();assert.equal(h.camera.running,true);assert.equal(h.speech.running,false);
  h.speechActions.onStart();assert.equal(h.camera.running,false);assert.equal(h.speech.running,true);
  const before=h.state, cameraStops=h.camera.stops, speechStops=h.speech.stops;
  h.dispatchIntent('COMMAND',{text:'はじめから'});
  assert.equal(h.state,before);assert.equal(h.camera.running,false);assert.equal(h.speech.running,true);
  assert.equal(h.camera.stops,cameraStops);assert.equal(h.speech.stops,speechStops);
  h.dispatchIntent('COMMAND',{text:'停止'});
  assert.equal(h.state.phase,'stopped');assert.equal(h.camera.running,false);assert.equal(h.speech.running,false);
});

test('voice progress rejects a fresh-revision camera result until an explicit mode switch', async () => {
  const h=await harness();h.cameraActions.onStart();h.speechActions.onStart();
  h.speechInput.onDecision({...createManualEvent('NEXT',h.state),source:'voice'});
  assert.equal(h.state.step,1);
  h.cameraInput.onDecision({...createManualEvent('NEXT',h.state),source:'camera'});
  assert.equal(h.state.step,1,'the same combined gesture cannot advance again through camera');
  h.cameraActions.onStart();assert.equal(h.speech.running,false);assert.equal(h.camera.running,true);
  h.speechInput.onDecision({...createManualEvent('NEXT',h.state),source:'voice'});
  assert.equal(h.state.step,1);
  h.cameraInput.onDecision({...createManualEvent('NEXT',h.state),source:'camera'});
  assert.equal(h.state.step,2,'explicitly switching back enables the next camera operation');
});


test('presentation end blocks input restart until explicit preparation and notifies both panels', async () => {
  const h=await harness();h.speechActions.onStart();h.dispatchIntent('STOP');
  assert.equal(h.state.phase,'stopped');
  assert.equal(h.cameraStates.at(-1).phase,'stopped');
  assert.equal(h.speechStates.at(-1).phase,'stopped');
  h.cameraActions.onStart();h.speechActions.onStart();
  assert.equal(h.camera.running,false);assert.equal(h.speech.running,false);
  h.dispatchIntent('RESTART');assert.equal(h.state.phase,'idle');
  assert.equal(h.cameraStates.at(-1).phase,'idle');
  assert.equal(h.speechStates.at(-1).phase,'idle');
  h.speechActions.onStart();assert.equal(h.speech.running,true);
  assert.equal(h.state.phase,'presenting');assert.equal(h.camera.running,false);
});

test('manual switch stops both inputs and rejects queued sensor decisions', async () => {
  const h=await harness();h.speechActions.onStart();
  h.inputSettingsActions.onManual();
  assert.equal(h.camera.running,false);assert.equal(h.speech.running,false);
  const before=h.state;
  assert.equal(h.speechInput.onDecision({...createManualEvent('NEXT',before),source:'voice'}),false);
  assert.equal(h.cameraInput.onDecision({...createManualEvent('NEXT',before),source:'camera'}),false);
  assert.equal(h.state,before);
  h.dispatchIntent('NEXT');assert.equal(h.state.step,1);
});


test('inline recovery shares panel guards and publishes mode, result and phase', async () => {
  const h=await harness();
  assert.equal(h.inputSettingsActions.onCameraStart,h.cameraActions.onStart);
  assert.equal(h.inputSettingsActions.onSpeechStart,h.speechActions.onStart);
  h.inputSettingsActions.onSpeechStart();assert.equal(h.inputModes.at(-1),'voice');
  h.speechInput.onDecision({...createManualEvent('NEXT',h.state),source:'voice'});
  assert.equal(h.inputResults.at(-1).source,'voice');assert.ok(h.inputResults.at(-1).message);
  h.inputSettingsActions.onCameraStart();assert.equal(h.inputModes.at(-1),'camera');assert.equal(h.speech.running,false);
  h.inputSettingsActions.onManual();assert.equal(h.inputModes.at(-1),null);
  h.dispatchIntent('STOP');assert.equal(h.inputPhases.at(-1),'stopped');
  h.inputSettingsActions.onCameraStart();h.inputSettingsActions.onSpeechStart();
  assert.equal(h.camera.running,false);assert.equal(h.speech.running,false);
});
