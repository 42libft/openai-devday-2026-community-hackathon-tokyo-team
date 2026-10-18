import test from 'node:test';
import assert from 'node:assert/strict';
import {createSpeechInput, parseSpeechCommand} from '../src/input/speech.js';
import {createPresentationState, transitionPresentation} from '../src/state/presentation.js';
import {createManualEvent} from '../src/input/manual.js';

test('spoken commands normalize punctuation but reject descriptions, negation and lifecycle commands', () => {
  for (const text of ['次へ', ' 次へ。 ', '相棒、次へ！', '次 へ']) assert.deepEqual(parseSpeechCommand(text), {type:'NEXT'});
  assert.deepEqual(parseSpeechCommand('２枚目へ。'), {type:'REQUEST_JUMP',targetStep:1});
  for (const text of ['次へと言います','次へじゃない','次へ 前へ','準備','はじめから','検索 アイデア',null,'次へ'+' '.repeat(180)+'しない']) assert.equal(parseSpeechCommand(text), null);
});

function harness({unsupported = false} = {}) {
  let state = createPresentationState();
  state = transitionPresentation(state, createManualEvent('START', state));
  let at = 10000;
  const instances = [], statuses = [], decisions = [];
  class Recognition {
    constructor() {this.aborted=0;instances.push(this);}
    start() {this.started=true;this.onstart?.();}
    abort() {this.aborted++;this.onend?.();}
    say(text,index=0,final=true) {this.batch([text],index,final);}
    batch(texts,index=0,final=true) {const results=Array(index).fill(null);for(const text of texts){const result=[{transcript:text,confidence:0.99}];result.isFinal=final;results.push(result);}this.onresult?.({resultIndex:index,results});}
  }
  const voice = createSpeechInput({Recognition:unsupported?null:Recognition,now:()=>at,makeId:()=>`speech-${instances.length}`,
    getState:()=>state,onStatus:s=>statuses.push(s),onDecision:e=>{decisions.push(e);const next=transitionPresentation(state,e);const changed=next!==state;state=next;return changed;}});
  return {voice,instances,statuses,decisions,get state(){return state;},advance:(ms=2000)=>at+=ms,
    manual(type,payload={}){state=transitionPresentation(state,createManualEvent(type,state,payload));}};
}

test('microphone starts only explicitly; only final results act; duplicate result indices are ignored', () => {
  const h=harness(); assert.equal(h.instances.length,0); h.voice.start(); h.voice.start();
  assert.equal(h.instances.length,1); const r=h.instances[0]; assert.equal(r.lang,'ja-JP');
  r.onspeechstart();
  r.say('次へ',0,false); assert.equal(h.state.step,0);
  r.say('次へ'); assert.equal(h.state.step,1); assert.equal(h.decisions[0].source,'voice');
  r.say('次へ'); assert.equal(h.state.step,1); assert.equal(h.decisions.length,1);
  r.say('次へ',1); assert.equal(h.state.step,1);
  h.advance();r.onspeechstart();r.say('次へ',2);assert.equal(h.state.step,2);
});

test('stop and dispose invalidate late results even after a new listening session starts', () => {
  const h=harness();h.voice.start();const old=h.instances[0];
  h.voice.stop();assert.equal(old.aborted,1);old.say('次へ');assert.equal(h.state.step,0);
  h.voice.start();old.say('次へ',1);assert.equal(h.state.step,0);
  h.instances[1].onspeechstart();h.instances[1].say('次へ');assert.equal(h.state.step,1);
  h.voice.dispose();h.instances[1].say('前へ',1);h.voice.start();assert.equal(h.instances.length,2);assert.equal(h.state.step,1);
});

test('a state change during speech invalidates the captured command', () => {
  const h=harness();h.voice.start();const r=h.instances[0];r.onspeechstart();h.manual('NEXT');
  r.say('次へ');assert.equal(h.state.step,1);assert.equal(h.decisions.length,0);
  r.onspeechstart();r.say('前へ',1);assert.equal(h.state.step,0);
});

test('a stale batch stays rejected until a new speechstart, including its later result events', () => {
  const h=harness();h.voice.start();const r=h.instances[0];r.onspeechstart();h.manual('NEXT');
  r.batch(['次へ','次へ']);assert.equal(h.state.step,1);assert.equal(h.decisions.length,0);
  h.advance();r.say('前へ',2);assert.equal(h.state.step,1);assert.equal(h.decisions.length,0);
  r.onspeechstart();r.batch(['次へ','次へ']);assert.equal(h.decisions.length,0);
  r.say('前へ',3);assert.equal(h.state.step,0);assert.equal(h.decisions.length,1);
});

test('one utterance cannot both propose and confirm a detour, even across result events', () => {
  const h=harness();h.voice.start();const r=h.instances[0];r.onspeechstart();
  r.batch(['3枚目へ','確認']);assert.equal(h.state.step,0);assert.equal(h.state.pendingJump.targetStep,2);
  assert.deepEqual(h.decisions.map(e=>e.type),['REQUEST_JUMP']);
  h.advance();r.say('確認',2);assert.equal(h.state.step,0);assert.equal(h.decisions.length,1);
  r.onspeechstart();r.say('確認',3);assert.equal(h.state.step,2);assert.equal(h.state.pendingJump,null);
  assert.deepEqual(h.decisions.map(e=>e.type),['REQUEST_JUMP','CONFIRM_JUMP']);
});

test('only a new speechstart arms an operation after missing onset or a rejected final', () => {
  const h=harness();h.voice.start();const r=h.instances[0];
  r.say('次へ');assert.equal(h.decisions.length,0);
  r.onspeechstart();r.batch(['次へと言います','次へ'],1);assert.equal(h.decisions.length,0);
  r.onspeechstart();r.say('前へ',3);assert.equal(h.decisions.length,1);assert.equal(h.state.step,0);
  r.say('次へ',4);assert.equal(h.decisions.length,1);assert.equal(h.state.step,0);
  r.onspeechstart();r.say('次へ',5);assert.equal(h.state.step,1);
  r.onspeechstart();r.say('前へ',6);assert.equal(h.state.step,0);
  h.advance();r.onspeechstart();r.say('次へ',7);assert.equal(h.state.step,1);
  r.onspeechstart();r.say('次へ',8);assert.equal(h.state.step,2);assert.equal(h.decisions.length,5);
  h.advance();r.say('次へ',9);assert.equal(h.state.step,2);assert.equal(h.decisions.length,5);
  r.onspeechstart();r.say('前へ',10);assert.equal(h.state.step,1);assert.equal(h.decisions.length,6);
});

test('permission/network errors stop recognition without automatic restarts and explicit restart works', () => {
  for(const error of ['not-allowed','network','audio-capture','no-speech']) {
    const h=harness();h.voice.start();const r=h.instances[0];r.onerror({error});
    assert.equal(r.aborted,1);assert.equal(h.statuses.at(-1).status,'error');r.say('次へ');assert.equal(h.state.step,0);
    h.voice.start();assert.equal(h.instances.length,2);h.instances[1].onspeechstart();h.instances[1].say('次へ');assert.equal(h.state.step,1);
  }
});

test('unsupported recognition, browser end and construction failures have clear inactive states', () => {
  const h=harness({unsupported:true});assert.equal(h.voice.supported,false);h.voice.start();assert.equal(h.statuses.at(-1).status,'unsupported');
  const ready=harness();ready.voice.start();ready.instances[0].onend();ready.instances[0].say('次へ');assert.equal(ready.state.step,0);assert.equal(ready.statuses.at(-1).status,'stopped');
  const statuses=[];const bad=createSpeechInput({Recognition:class {constructor(){throw new Error('failure');}},getState:()=>ready.state,onDecision:()=>assert.fail(),onStatus:s=>statuses.push(s)});
  bad.start();assert.equal(statuses.at(-1).status,'error');
});

test('voice detour confirmation and resume restore the prior search and selection', () => {
  const h=harness();h.manual('NEXT');h.manual('SEARCH',{query:'チーム'});h.manual('SELECT',{selectedId:'team-board'});
  h.voice.start();const r=h.instances[0];r.onspeechstart();r.say('3枚目へ');assert.equal(h.state.pendingJump.targetStep,2);
  h.advance();r.onspeechstart();r.say('次へ',1);assert.equal(h.state.step,1);assert.notEqual(h.state.pendingJump,null);
  h.advance();r.onspeechstart();r.say('確認',2);assert.equal(h.state.step,2);assert.equal(h.state.query,'');
  h.advance();r.onspeechstart();r.say('続きへ',3);assert.equal(h.state.step,1);assert.equal(h.state.query,'チーム');assert.equal(h.state.selectedId,'team-board');
  h.advance();r.onspeechstart();r.say('停止',4);assert.equal(h.state.phase,'stopped');
});

test('voice source cannot start, restart, select or search', () => {
  const h=harness();
  for (const type of ['START','RESTART','SELECT','SEARCH']) {
    const state=h.state;assert.equal(transitionPresentation(state,{...createManualEvent(type,state),source:'voice'}),state);
  }
});


test('distinct onsets at 0, 1000, 1199 and 1200 ms are not treated as result replays', () => {
  for(const delay of [0,1000,1199,1200]) {
    const h=harness();h.voice.start();const r=h.instances[0];r.onspeechstart();r.say('次へ');
    h.advance(delay);r.onspeechstart();r.say('次へ',1);
    assert.equal(h.state.step,2);assert.equal(h.decisions.length,2);
    r.say('次へ',1);r.say('前へ',2);assert.equal(h.decisions.length,2);
    r.onspeechstart();r.say('前へ',3);assert.equal(h.state.step,1);
  }
});
