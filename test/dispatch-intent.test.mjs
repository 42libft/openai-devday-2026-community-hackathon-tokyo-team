import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { createController } from '../src/controller.js';
import { createPresentationState, transitionPresentation } from '../src/state/presentation.js';
import { createManualEvent, parseCommand, commandForKey } from '../src/input/manual.js';
import { bindInputLifecycle } from '../src/input/lifecycle.js';
import {slides} from './slides-fixture.js';
import { createUploadSession } from '../src/slides/upload.js';

async function harness({empty=false}={}) {
  let uploadActions, dispatchIntent, state, cameraActions, speechActions, cameraInput, speechInput, inputSettingsActions;
  const cameraStates=[],speechStates=[];
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
    createController, createPresentationState: () => createPresentationState(empty ? [] : slides()), transitionPresentation,
    createManualEvent, parseCommand, commandForKey, bindInputLifecycle,
    document, window: new EventTarget(),
    mountInputSettings: (_, actions) => {
      inputSettingsActions = actions;
      return {cameraContainer: {}, speechContainer: {}, showPresentation() {}, setStatus() {}};
    },
    mountDeckUpload: (_, actions) => {uploadActions=actions;return {setState() {}};}, createUploadSession,
    loadSlideDeck: async () => ({name:'test.pdf',steps:slides(5),destroy(){}}),
    createSlidePresenter: () => ({show() {}, destroy() {}}),
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

  return {uploadActions,camera,speech,cameraActions,speechActions,cameraInput,speechInput,inputSettingsActions,cameraStates,speechStates,dispatchIntent,get state(){return state;}};
}

test('input mode switching is exclusive; rejected restart keeps the selected mode running', async () => {
  const h=await harness();
  h.cameraActions.onStart();assert.equal(h.camera.running,true);assert.equal(h.speech.running,false);
  h.speechActions.onStart();assert.equal(h.camera.running,false);assert.equal(h.speech.running,true);
  const before=h.state, cameraStops=h.camera.stops, speechStops=h.speech.stops;
  h.dispatchIntent('RESTART');
  assert.equal(h.state,before);assert.equal(h.camera.running,false);assert.equal(h.speech.running,true);
  assert.equal(h.camera.stops,cameraStops);assert.equal(h.speech.stops,speechStops);
  h.dispatchIntent('STOP');
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

test('without imported slides, camera/voice start cannot start sensors; import prepares real count', async () => {
 const h=await harness({empty:true});h.cameraActions.onStart();h.speechActions.onStart();
 assert.equal(h.state.phase,'idle');assert.equal(h.camera.running,false);assert.equal(h.speech.running,false);
 h.uploadActions.onSelect({name:'test.pdf',size:100,arrayBuffer(){}});await new Promise(r=>setImmediate(r));
 assert.equal(h.state.stepCount,5);h.dispatchIntent('START');assert.equal(h.state.phase,'presenting');
 const active=h.state;h.uploadActions.onSelect({name:'other.pdf'});await new Promise(r=>setImmediate(r));assert.equal(h.state,active);
});
