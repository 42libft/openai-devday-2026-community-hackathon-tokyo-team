import assert from 'node:assert/strict';
import test from 'node:test';
import {createPresentationState, transitionPresentation as transition} from '../src/state/presentation.js';
import {createManualEvent, parseCommand} from '../src/input/manual.js';
import {slides} from './slides-fixture.js';
const act = (s, type, payload = {}) => transition(s, createManualEvent(type, s, payload));
const start = (count = 5) => act(createPresentationState(slides(count)), 'START');
const freeze = value => {if (value && typeof value === 'object') {Object.values(value).forEach(freeze);Object.freeze(value);}return value;};

test('empty preparation cannot start or move without imported slides', () => {
  const state = createPresentationState();
  for (const type of ['START','NEXT','PREVIOUS','REQUEST_JUMP','EDIT_NOTE','STOP']) assert.equal(act(state,type),state);
});

test('actual page count controls navigation and voice jump bounds for 1, 5 and 100 slides', () => {
  for (const count of [1,5,100]) {
    let state = start(count);
    assert.equal(act(state,'PREVIOUS'),state);
    for (let page=1;page<count;page++) state=act(state,'NEXT');
    assert.equal(state.step,count-1);assert.equal(act(state,'NEXT'),state);
    const command=parseCommand(`${count + 1}枚目へ`, {stepCount:999});
    assert.equal(act(state,command.type,command),state);
    if(count>1){
      state=act(state,'PREVIOUS');
      const intent=parseCommand(`${count}枚目へ`, {stepCount:100});
      state=transition(state,{...createManualEvent(intent.type,state,intent),source:'voice'});
      assert.equal(state.pendingJump.targetStep,count-1);
      state=act(state,'CONFIRM_JUMP');assert.equal(state.step,count-1);
    }
  }
});

test('preview and optional notes follow the actual page; start resets to page one', () => {
  let state=createPresentationState(slides(5));
  state=act(state,'PREVIEW',{targetStep:4});
  state=act(state,'EDIT_NOTE',{notes:'質問への補足\nメモ'});
  assert.equal(state.slides[4].notes,'質問への補足\nメモ');assert.equal(state.slides[0].notes,'');
  for(const notes of [null,1,'x'.repeat(4001)])assert.equal(act(state,'EDIT_NOTE',{notes}),state);
  state=act(state,'START');assert.equal(state.step,0);
  assert.equal(act(state,'EDIT_NOTE',{notes:'発表中の変更'}),state);
  state=act(act(state,'STOP'),'RESTART');assert.equal(state.slides[4].notes,'質問への補足\nメモ');
});

test('detour, movement, resume and single undo keep the original bookmark', () => {
  let state=act(start(),'NEXT');
  state=act(state,'REQUEST_JUMP',{targetStep:4});assert.equal(state.step,1);
  state=act(state,'CONFIRM_JUMP');assert.equal(state.resumeSnapshot.step,1);
  assert.equal(act(state,'REQUEST_JUMP',{targetStep:0}),state,'nested bookmark is rejected');
  state=act(state,'PREVIOUS');state=act(state,'UNDO');assert.equal(state.step,4);assert.equal(state.resumeSnapshot.step,1);
  assert.equal(act(state,'UNDO'),state);
  state=act(state,'RESUME');assert.equal(state.step,1);assert.equal(state.resumeSnapshot,null);
  state=act(state,'UNDO');assert.equal(state.step,4);assert.equal(state.resumeSnapshot.step,1);
  state=act(state,'RESUME');assert.equal(state.step,1);
});

test('undoing detour restores location and removes bookmark; proposals do not overwrite undo', () => {
  let state=act(start(),'NEXT');
  state=act(state,'REQUEST_JUMP',{targetStep:4});state=act(state,'CANCEL_JUMP');
  state=act(state,'UNDO');assert.equal(state.step,0);
  state=act(state,'REQUEST_JUMP',{targetStep:4});state=act(state,'CONFIRM_JUMP');
  state=act(state,'UNDO');assert.equal(state.step,0);assert.equal(state.resumeSnapshot,null);
});

test('invalid page requests and stale confirmations preserve state', () => {
  let state=start();
  for(const targetStep of [-1,5,0,1.2,'1',null,undefined])assert.equal(act(state,'REQUEST_JUMP',{targetStep}),state);
  assert.equal(act(state,'CONFIRM_JUMP'),state);
  state=act(state,'REQUEST_JUMP',{targetStep:4});
  const old=createManualEvent('CONFIRM_JUMP',state);
  state=act(state,'CANCEL_JUMP');assert.equal(transition(state,old),state);
  state=act(state,'REQUEST_JUMP',{targetStep:4});state=act(state,'NEXT');
  assert.equal(state.pendingJump,null);assert.equal(act(state,'CONFIRM_JUMP'),state);
});

test('failed deck replacement is atomic; valid replacement invalidates old sessions and history', () => {
  let state=act(createPresentationState(slides(5)),'PREVIEW',{targetStep:4});const old=createManualEvent('START',state);
  for(const deck of [[],slides(101),[null],Array(1),slides(2).map(s=>({...s,title:null})),[slides(1)[0],slides(1)[0]]]){
    assert.equal(act(state,'LOAD_DECK',{slides:deck}),state);
  }
  const next=act(state,'LOAD_DECK',{slides:slides(1)});
  assert.equal(next.phase,'idle');assert.equal(next.slides.length,1);assert.equal(next.step,0);
  assert.equal(next.sessionEpoch,state.sessionEpoch+1);assert.equal(next.undoSnapshot,null);assert.equal(next.resumeSnapshot,null);
  assert.equal(transition(next,{...old,baseRevision:0}),next);
  const active=act(next,'START');assert.equal(act(active,'LOAD_DECK',{slides:slides(2)}),active);
  assert.equal(act(next,'START').phase,'presenting');
});

test('stop freezes position and notes; restart retains deck and rejects old input', () => {
  let state=act(start(),'NEXT');state=act(state,'REQUEST_JUMP',{targetStep:4});
  const old=createManualEvent('NEXT',state);state=act(state,'STOP');
  assert.equal(state.step,1);assert.equal(state.pendingJump,null);
  for(const type of ['START','NEXT','PREVIOUS','UNDO','RESUME','STOP','EDIT_NOTE'])assert.equal(act(state,type),state);
  const stopped=state;state=act(state,'RESTART');assert.equal(state.phase,'idle');assert.deepEqual(state.slides,stopped.slides);
  assert.equal(state.sessionEpoch,stopped.sessionEpoch+1);assert.equal(state.revision,0);assert.equal(transition(state,old),state);
});

test('malformed, repeated, wrong-source and stale envelopes never change state', () => {
  let state=start();const good=createManualEvent('NEXT',state);
  for(const patch of [{eventId:''},{eventId:' bad'},{eventId:'a\nb'},{baseRevision:-1},{baseRevision:NaN},{sessionEpoch:0},{source:'unknown'},{type:'SEARCH'}])assert.equal(transition(state,{...good,...patch}),state);
  for(const invalid of [null,[],true,'NEXT',{}])assert.equal(transition(state,invalid),state);
  state=transition(state,good);assert.equal(transition(state,good),state);
  for(const type of ['LOAD_DECK','EDIT_NOTE','PREVIEW','STOP','REQUEST_JUMP','UNDO'])assert.equal(transition(state,{...createManualEvent(type,state),source:'camera'}),state);
});

test('frozen state and events are not mutated through detour, undo and replacement', () => {
  let state=freeze(createPresentationState(slides(5)));
  for(const [type,payload] of [['START',{}],['NEXT',{}],['REQUEST_JUMP',{targetStep:4}],['CONFIRM_JUMP',{}],['PREVIOUS',{}],['RESUME',{}],['UNDO',{}],['STOP',{}],['RESTART',{}],['LOAD_DECK',{slides:slides(1)}]]){
    const before=structuredClone(state);const next=transition(state,freeze(createManualEvent(type,state,payload)));
    assert.notEqual(next,state,type);assert.deepEqual(state,before);state=freeze(next);
  }
});
