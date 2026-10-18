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
  let state=createPresentationState();state=transitionPresentation(state,createManualEvent('START',state));
  const instances=[],statuses=[],decisions=[];
  class Recognition {
    constructor(){this.aborted=0;instances.push(this);}
    start(){this.onstart?.();}
    abort(){this.aborted++;this.onend?.();}
    say(text,index=0,final=true,end=final){this.batch([text],index,final,end);}
    batch(texts,index=0,final=true,end=final){
      const results=Array(index).fill(null);
      for(const text of texts){const r=[{transcript:text,confidence:1}];r.isFinal=final;results.push(r);}
      this.onresult?.({resultIndex:index,results});if(end)this.onend?.();
    }
  }
  const voice=createSpeechInput({Recognition:unsupported?null:Recognition,makeId:()=>`speech-${instances.length}`,
    getState:()=>state,onStatus:s=>statuses.push(s),onDecision:e=>{decisions.push(e);const next=transitionPresentation(state,e);const changed=next!==state;state=next;return changed;}});
  return {voice,instances,statuses,decisions,get state(){return state;},
    say(text){instances.at(-1).say(text);},
    camera(type){state=transitionPresentation(state,{...createManualEvent(type,state),source:'camera'});},
    manual(type,payload={}){state=transitionPresentation(state,createManualEvent(type,state,payload));}};
}

test('single-command sessions accept successive commands without synthetic speechstart events', () => {
  const h=harness();assert.equal(h.instances.length,0);h.voice.start();h.voice.start();
  const first=h.instances[0];assert.equal(first.continuous,false);assert.equal(first.lang,'ja-JP');
  first.say('次へ',0,false,false);assert.equal(h.state.step,0);
  first.say('次へ');assert.equal(h.state.step,1);assert.equal(h.instances.length,2);
  first.say('次へ',1);assert.equal(h.decisions.length,1,'old recognizer cannot advance a new frame');
  h.say('次へ');assert.equal(h.state.step,2);h.say('前へ');assert.equal(h.state.step,1);
  assert.deepEqual(h.decisions.map(e=>e.type),['NEXT','NEXT','PREVIOUS']);
});

test('explanatory or unmatched speech finishes one run and does not disable later explicit commands', () => {
  const h=harness();h.voice.start();h.say('それでは説明します');assert.equal(h.decisions.length,0);
  h.say('次へ');assert.equal(h.state.step,1);
  h.instances.at(-1).onnomatch();h.instances.at(-1).onend();
  h.say('前へ');assert.equal(h.state.step,0);
});

test('a run captures its frame once, rejects state changes and never rebases a stale batch', () => {
  const h=harness();h.voice.start();const old=h.instances[0];h.manual('NEXT');
  old.onspeechstart?.();old.batch(['次へ','次へ']);
  assert.equal(h.state.step,1);assert.equal(h.decisions.length,0);
  old.say('前へ',2);assert.equal(h.state.step,1);
  h.say('前へ');assert.equal(h.state.step,0);
});

test('one run cannot both propose and confirm a detour, including later events before end', () => {
  const h=harness();h.voice.start();const first=h.instances[0];
  first.batch(['3枚目へ','確認'],0,true,false);
  assert.equal(h.state.step,0);assert.equal(h.state.pendingJump.targetStep,2);
  first.say('確認',2,true,false);assert.equal(h.decisions.length,1);
  first.onend();h.say('確認');assert.equal(h.state.step,2);
  assert.deepEqual(h.decisions.map(e=>e.type),['REQUEST_JUMP','CONFIRM_JUMP']);
});

test('duplicate indices and additional finals never execute twice within one run', () => {
  const h=harness();h.voice.start();const r=h.instances[0];
  r.say('次へ',0,true,false);r.say('次へ',0,true,false);r.say('前へ',1,true,false);
  assert.equal(h.state.step,1);assert.equal(h.decisions.length,1);
  r.onend();h.say('前へ');assert.equal(h.state.step,0);
});

test('stop and dispose invalidate late results and pending continuation after a processed final', () => {
  const h=harness();h.voice.start();const old=h.instances[0];old.say('次へ',0,true,false);
  h.voice.stop();old.onend();old.say('次へ',1);assert.equal(h.instances.length,1);assert.equal(h.state.step,1);
  h.voice.start();old.say('次へ',2);h.say('前へ');assert.equal(h.state.step,0);
  const current=h.instances.at(-1);h.voice.dispose();current.say('次へ');h.voice.start();
  assert.equal(h.state.step,0);assert.equal(current.aborted,1);
});

test('an earlier presentation session cannot execute a late command or trigger continuation', () => {
  const h=harness();h.voice.start();const old=h.instances[0];
  h.manual('STOP');h.manual('RESTART');h.manual('START');old.say('次へ');
  assert.equal(h.state.step,0);assert.equal(h.decisions.length,0);assert.equal(h.instances.length,1);
  assert.equal(h.statuses.at(-1).status,'stopped');
});

test('permission/network errors and unexpected end require explicit restart', () => {
  for(const error of ['not-allowed','network','audio-capture','no-speech']){
    const h=harness();h.voice.start();const r=h.instances[0];r.onerror({error});r.onend();
    assert.equal(r.aborted,1);assert.equal(h.instances.length,1);assert.equal(h.statuses.at(-1).status,'error');
    h.voice.start();h.say('次へ');assert.equal(h.state.step,1);h.voice.stop();
  }
  const h=harness();h.voice.start();h.instances[0].onend();assert.equal(h.instances.length,1);
  assert.equal(h.statuses.at(-1).status,'stopped');
});

test('unsupported recognition and construction failure remain inactive', () => {
  const h=harness({unsupported:true});h.voice.start();assert.equal(h.statuses.at(-1).status,'unsupported');
  const statuses=[];createSpeechInput({Recognition:class{constructor(){throw new Error('no');}},getState:()=>({phase:'presenting'}),onDecision:()=>assert.fail(),onStatus:s=>statuses.push(s)}).start();
  assert.equal(statuses.at(-1).status,'error');
});

test('voice detour and resume preserve the selected search; STOP does not start another run', () => {
  const h=harness();h.manual('NEXT');h.manual('SEARCH',{query:'チーム'});h.manual('SELECT',{selectedId:'team-board'});
  h.voice.start();h.say('3枚目へ');h.say('確認');assert.equal(h.state.step,2);
  h.say('続きへ');assert.equal(h.state.step,1);assert.equal(h.state.query,'チーム');assert.equal(h.state.selectedId,'team-board');
  const count=h.instances.length;h.say('停止');assert.equal(h.state.phase,'stopped');assert.equal(h.instances.length,count);
});

test('voice source cannot start, restart, select or search', () => {
  const h=harness();for(const type of ['START','RESTART','SELECT','SEARCH'])assert.equal(transitionPresentation(h.state,{...createManualEvent(type,h.state),source:'voice'}),h.state);
});


test('single-command STOP tolerates a same-session camera or manual revision change', () => {
  for(const source of ['manual','camera']) {
    const h=harness();h.voice.start();
    if(source==='camera')h.camera('NEXT');else h.manual('NEXT');
    const revision=h.state.revision;h.say('停止');assert.equal(h.state.phase,'stopped');
    assert.equal(h.decisions[0].baseRevision,revision);
  }
});

test('STOP from a previous presentation session does not stop the new presentation', () => {
  const h=harness();h.voice.start();const old=h.instances[0];
  h.manual('STOP');h.manual('RESTART');h.manual('START');old.say('停止');
  assert.equal(h.state.phase,'presenting');assert.equal(h.decisions.length,0);assert.equal(h.instances.length,1);
});


test('nomatch closes the old frame and the next recognizer accepts a valid command', () => {
  const h=harness();h.voice.start();const old=h.instances[0];old.onnomatch();
  old.say('次へ',0,true,false);assert.equal(h.decisions.length,0);
  old.onend();assert.equal(h.instances.length,2);h.say('次へ');
  assert.equal(h.state.step,1);assert.equal(h.decisions.length,1);assert.equal(old.aborted,0);
});
