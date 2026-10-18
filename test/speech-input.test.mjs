import test, {afterEach} from 'node:test';
const openVoices=[];
afterEach(()=>{for(const voice of openVoices.splice(0))voice.dispose();});
import assert from 'node:assert/strict';
import {createSpeechInput, parseSpeechCommand} from '../src/input/speech.js';
import {createPresentationState, transitionPresentation} from '../src/state/presentation.js';
import {createManualEvent} from '../src/input/manual.js';

test('spoken commands normalize punctuation but reject descriptions, negation and lifecycle commands', () => {
  for (const text of ['次へ', ' 次へ。 ', '相棒、次へ！', '次 へ']) assert.deepEqual(parseSpeechCommand(text), {type:'NEXT'});
  assert.deepEqual(parseSpeechCommand('２枚目へ。'), {type:'REQUEST_JUMP',targetStep:1});
  for (const text of ['次へと言います','次へじゃない','次へ 前へ','準備','はじめから','検索 アイデア',null,'次へ'+' '.repeat(180)+'しない']) assert.equal(parseSpeechCommand(text), null);
});

function harness({unsupported = false, delayedAbort = false} = {}) {
  let at = 10000;
  const abortedEnds = [];
  let state=createPresentationState();state=transitionPresentation(state,createManualEvent('START',state));
  const instances=[],statuses=[],decisions=[];
  class Recognition {
    constructor(){this.aborted=0;instances.push(this);}
    start(){this.onstart?.();}
    abort(){this.aborted++;if(delayedAbort)abortedEnds.push(()=>this.onend?.());else this.onend?.();}
    say(text,index=0,final=true,end=final){this.batch([text],index,final,end);}
    batch(texts,index=0,final=true,end=final){
      const results=Array(index).fill(null);
      for(const text of texts){const r=[{transcript:text,confidence:1}];r.isFinal=final;results.push(r);}
      this.onresult?.({resultIndex:index,results});if(end)this.onend?.();
    }
  }
  const voice=createSpeechInput({Recognition:unsupported?null:Recognition,now:()=>at,makeId:()=>`speech-${instances.length}`,
    getState:()=>state,onStatus:s=>statuses.push(s),onDecision:e=>{decisions.push(e);const next=transitionPresentation(state,e);const changed=next!==state;state=next;return changed;}});
  openVoices.push(voice);
  return {voice,instances,statuses,decisions,get state(){return state;},
    advance:(ms=2000)=>at+=ms,
    flushAbortedEnds(){for(const end of abortedEnds.splice(0))end();},
    camera(type){state=transitionPresentation(state,{...createManualEvent(type,state),source:'camera'});},
    say(text){instances.at(-1).say(text);},
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

test('silent waiting before and after a command survives well beyond six seconds', t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const h=harness();h.voice.start();
  for(const command of ['次へ','前へ']) {
    const r=h.instances.at(-1);
    h.advance(60000);t.mock.timers.tick(60000);
    assert.equal(r.aborted,0);
    assert.equal(h.statuses.at(-1).status,'listening');
    r.say(command);
  }
  assert.deepEqual(h.decisions.map(e=>e.type),['NEXT','PREVIOUS']);
  assert.equal(h.state.step,0);
});

test('a silent browser end or no-speech error resumes after a delay without reusing old results', t => {
  t.mock.timers.enable({apis:['setTimeout']});
  for(const reason of ['end','no-speech']) {
    const h=harness({delayedAbort:true});h.voice.start();const old=h.instances[0];
    if(reason==='end')old.onend();else old.onerror({error:'no-speech'});
    assert.equal(h.instances.length,1,'do not restart in an immediate loop');
    assert.equal(h.statuses.at(-1).status,'listening');
    h.advance(250);t.mock.timers.tick(250);
    assert.equal(h.instances.length,2);
    old.say('次へ');h.flushAbortedEnds();
    assert.equal(h.decisions.length,0);
    h.advance(60000);t.mock.timers.tick(60000);h.say('次へ');
    assert.equal(h.state.step,1);h.voice.stop();
  }
});

test('interim results without speechstart get one deadline that later updates cannot extend', t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const h=harness();h.voice.start();const old=h.instances[0];
  h.advance(60000);t.mock.timers.tick(60000);old.say('説明しています',0,false,false);
  h.advance(5000);t.mock.timers.tick(5000);old.say('説明を続けています',0,false,false);
  old.onspeechstart();
  h.advance(1000);t.mock.timers.tick(1000);
  assert.equal(old.aborted,1);assert.equal(h.decisions.length,0);
  h.advance(250);t.mock.timers.tick(250);
  old.say('次へ');assert.equal(h.decisions.length,0);
  h.say('次へ');assert.equal(h.state.step,1);
});

test('pending retries are cancelled by explicit stop, disposal, presentation end or a new session', t => {
  t.mock.timers.enable({apis:['setTimeout']});
  for(const reason of ['stop','dispose','STOP','RESTART']) {
    const h=harness({delayedAbort:true});h.voice.start();const old=h.instances[0];
    old.onerror({error:'no-speech'});
    if(reason==='stop')h.voice.stop();
    else if(reason==='dispose')h.voice.dispose();
    else {h.manual('STOP');if(reason==='RESTART'){h.manual('RESTART');h.manual('START');}}
    h.advance(10000);t.mock.timers.tick(10000);
    h.flushAbortedEnds();old.say('次へ');
    assert.equal(h.instances.length,1,reason);
    assert.equal(h.decisions.length,0,reason);
    assert.equal(h.statuses.at(-1).status,'stopped',reason);
    h.voice.stop();
  }
});

test('stopping a timed-out run cancels recovery even after explicitly starting a new mode', t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const h=harness({delayedAbort:true});h.voice.start();const old=h.instances[0];old.onspeechstart();
  h.advance(6000);t.mock.timers.tick(6000);h.voice.stop();h.voice.start();
  const fresh=h.instances[1];h.advance(1000);t.mock.timers.tick(1000);
  h.flushAbortedEnds();old.onerror({error:'no-speech'});old.say('次へ');
  assert.equal(h.instances.length,2);assert.equal(fresh.aborted,0);assert.equal(h.decisions.length,0);
  fresh.say('次へ');assert.equal(h.state.step,1);
});

test('repeated empty runs back off rather than spinning and can still accept a command', t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const h=harness();h.voice.start();
  for(const delay of [250,500,1000,2000,2000]) {
    const count=h.instances.length;h.instances.at(-1).onend();
    h.voice.start();h.advance(delay-1);t.mock.timers.tick(delay-1);
    assert.equal(h.instances.length,count);
    h.advance(1);t.mock.timers.tick(1);assert.equal(h.instances.length,count+1);
  }
  h.say('次へ');assert.equal(h.state.step,1);
  const count=h.instances.length;h.instances.at(-1).onend();
  h.advance(250);t.mock.timers.tick(250);assert.equal(h.instances.length,count+1);
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

test('permission, device and network errors still require explicit restart', () => {
  for(const error of ['not-allowed','service-not-allowed','network','audio-capture','language-not-supported','unknown']){
    const h=harness();h.voice.start();const r=h.instances[0];r.onerror({error});r.onend();
    assert.equal(r.aborted,1);assert.equal(h.instances.length,1);assert.equal(h.statuses.at(-1).status,'error');
    h.voice.start();h.say('次へ');assert.equal(h.state.step,1);h.voice.stop();
  }
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

test('a new onset before the prior final stops ambiguous recognition instead of rebasing old speech', () => {
  const h=harness();h.voice.start();const old=h.instances[0];
  old.onspeechstart();h.manual('NEXT');old.onspeechstart();
  old.batch(['次へ','前へ']);
  assert.equal(h.state.step,1);assert.equal(h.decisions.length,0);
  assert.equal(old.aborted,1);assert.equal(h.instances.length,1);
  assert.equal(h.statuses.at(-1).status,'stopped');
  assert.match(h.statuses.at(-1).message,/開始ボタン/);

  // Restarting explicitly must not allow events from the invalidated recognizer.
  h.voice.start();const fresh=h.instances[1];fresh.onspeechstart();
  old.onspeechstart();old.say('次へ',2);old.onerror({error:'network'});
  assert.equal(h.state.step,1);assert.equal(h.decisions.length,0);
  fresh.say('前へ');assert.equal(h.state.step,0);assert.equal(h.decisions.length,1);
});

test('overlapping onsets are rejected even without a state change or after interim speech', () => {
  for (const interim of [false,true]) {
    const h=harness();h.voice.start();const r=h.instances[0];r.onspeechstart();
    if(interim)r.say('次へ',0,false);
    r.onspeechstart();r.say('次へ');
    assert.equal(h.state.step,0);assert.equal(h.decisions.length,0);
    assert.equal(r.aborted,1);assert.equal(h.statuses.at(-1).status,'stopped');
  }
});

test('a late confirmation after overlapping speech cannot confirm a pending detour', () => {
  const h=harness();h.voice.start();const r=h.instances[0];
  r.onspeechstart();h.manual('REQUEST_JUMP',{targetStep:2});r.onspeechstart();
  r.say('確認');
  assert.equal(h.state.step,0);assert.equal(h.state.pendingJump.targetStep,2);
  assert.equal(h.decisions.length,0);assert.equal(r.aborted,1);
});

test('STOP remains valid after a same-session manual or camera revision change', () => {
  for(const source of ['manual','camera']) {
    const h=harness();h.voice.start();const r=h.instances[0];r.onspeechstart();
    if(source==='camera')h.camera('NEXT');else h.manual('NEXT');
    const revision=h.state.revision;
    r.say('停止');assert.equal(h.state.phase,'stopped');
    assert.equal(h.decisions.length,1);assert.equal(h.decisions[0].baseRevision,revision);
  }
});

test('STOP from an earlier presentation session remains rejected', () => {
  const h=harness();h.voice.start();const r=h.instances[0];r.onspeechstart();
  h.manual('STOP');h.manual('RESTART');h.manual('START');
  r.say('停止');assert.equal(h.state.phase,'presenting');assert.equal(h.decisions.length,0);
});

test('successive identical commands are accepted within 1200ms in distinct recognizers', () => {
  const h=harness();h.voice.start();h.say('次へ');h.advance(100);h.say('次へ');
  assert.equal(h.state.step,2);assert.deepEqual(h.decisions.map(e=>e.type),['NEXT','NEXT']);
});

test('speech final before 6000ms applies; at or after the deadline its run is discarded', t => {
  t.mock.timers.enable({apis:['setTimeout']});
  for(const delay of [5999,6000,6001]) {
    const h=harness();h.voice.start();const r=h.instances[0];r.onspeechstart();r.say('次へ',0,false,false);
    h.advance(delay);t.mock.timers.tick(delay);
    if(delay<6000){r.say('次へ',0,true,false);assert.equal(h.state.step,1);}
    else {
      assert.equal(h.statuses.at(-1).status,'listening');assert.match(h.statuses.at(-1).message,/6秒/);
      r.say('次へ');assert.equal(h.state.step,0);assert.equal(r.aborted,1);
      h.advance(250);t.mock.timers.tick(250);h.say('次へ');assert.equal(h.state.step,1);
    }
    h.voice.stop();
  }
});

test('elapsed deadline rejects a final even if the timeout callback is delayed', t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const h=harness();h.voice.start();const r=h.instances[0];r.onspeechstart();
  h.advance(6000);r.say('次へ');
  assert.equal(h.state.step,0);assert.equal(h.decisions.length,0);assert.equal(h.instances.length,1);
  assert.equal(r.aborted,1);assert.equal(h.statuses.at(-1).status,'listening');
});

test('timeout rejects late results and old end after automatically awaiting the next utterance', t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const h=harness({delayedAbort:true});h.voice.start();const old=h.instances[0];old.onspeechstart();
  h.advance(6000);t.mock.timers.tick(6000);h.voice.start();
  assert.equal(h.instances.length,1,'explicit start does not duplicate a pending retry');
  h.advance(250);t.mock.timers.tick(250);const fresh=h.instances[1];
  old.say('次へ');h.flushAbortedEnds();old.onerror({error:'network'});assert.equal(h.state.step,0);
  h.advance(1000);t.mock.timers.tick(1000);fresh.say('次へ',0,true,false);assert.equal(h.state.step,1);
  const count=h.statuses.length;h.advance(10000);t.mock.timers.tick(10000);
  assert.equal(h.statuses.length,count);assert.equal(fresh.aborted,0);h.voice.stop();
});

test('stop, fatal error and dispose cancel the wait timer; a new run owns its deadline', t => {
  t.mock.timers.enable({apis:['setTimeout']});
  for(const end of ['stop','error','dispose']) {
    const h=harness();h.voice.start();const r=h.instances[0];r.onspeechstart();
    if(end==='stop')h.voice.stop();else if(end==='error')r.onerror({error:'network'});else h.voice.dispose();
    const count=h.statuses.length;t.mock.timers.tick(6001);assert.equal(h.statuses.length,count);
  }
  const h=harness();h.voice.start();h.advance(2000);t.mock.timers.tick(2000);
  h.voice.stop();h.voice.start();h.advance(4001);t.mock.timers.tick(4001);
  assert.equal(h.statuses.at(-1).status,'listening');h.say('次へ');assert.equal(h.state.step,1);
});

test('a first speech onset starts its deadline without replacing the captured frame', t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const h=harness();h.voice.start();const r=h.instances[0];
  h.advance(2000);t.mock.timers.tick(2000);h.manual('NEXT');r.onspeechstart();
  h.advance(4001);t.mock.timers.tick(4001);assert.equal(r.aborted,0);
  r.say('次へ');assert.equal(h.state.step,1);assert.equal(h.decisions.length,0);
});

test('automatic continuation owns a fresh timeout and old callbacks cannot end it', t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const h=harness();h.voice.start();const old=h.instances[0];old.onspeechstart();
  h.advance(5000);t.mock.timers.tick(5000);old.say('次へ');const fresh=h.instances[1];
  h.advance(1001);t.mock.timers.tick(1001);old.onend();old.onerror({error:'network'});old.say('次へ',1);
  assert.equal(fresh.aborted,0);assert.equal(h.decisions.length,1);assert.equal(h.instances.length,2);
  h.advance(60000);t.mock.timers.tick(60000);assert.equal(fresh.aborted,0);
  fresh.onspeechstart();h.advance(6000);t.mock.timers.tick(6000);
  assert.equal(fresh.aborted,1);assert.equal(h.instances.length,2);
  assert.equal(h.statuses.at(-1).status,'listening');
});


test('stopping unsupported speech preserves capability and recovery guidance', () => {
  const h=harness({unsupported:true});h.voice.stop('カメラへ切り替え');
  assert.equal(h.statuses.at(-1).status,'unsupported');assert.equal(h.statuses.at(-1).supported,false);
  assert.match(h.statuses.at(-1).message,/対応していません/);
  h.voice.start();h.voice.stop();assert.equal(h.statuses.at(-1).status,'unsupported');
});

test('nomatch closes the old frame and the next recognizer accepts a valid command', () => {
  const h=harness();h.voice.start();const old=h.instances[0];old.onnomatch();
  old.say('次へ',0,true,false);assert.equal(h.decisions.length,0);
  old.onend();assert.equal(h.instances.length,2);h.say('次へ');
  assert.equal(h.state.step,1);assert.equal(h.decisions.length,1);assert.equal(old.aborted,0);
});


test('silent listening remains active beyond six seconds and a final without onset still acts', t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const h=harness();h.voice.start();const r=h.instances[0];
  r.say('   ',0,false,false);h.advance(12000);t.mock.timers.tick(12000);
  assert.equal(r.aborted,0);assert.equal(h.statuses.at(-1).status,'listening');
  r.say('次へ');assert.equal(h.state.step,1);assert.equal(h.decisions.length,1);
});

test('first nonempty interim starts one deadline and later interim or onset cannot extend it', t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const h=harness();h.voice.start();const r=h.instances[0];
  h.advance(10000);t.mock.timers.tick(10000);r.say('次',0,false,false);
  h.advance(5000);t.mock.timers.tick(5000);r.say('次へ',0,false,false);r.onspeechstart();
  h.advance(1000);r.say('次へ',0,true,false);
  assert.equal(h.decisions.length,0);assert.equal(r.aborted,1);assert.equal(h.statuses.at(-1).status,'listening');
});
