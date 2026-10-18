import assert from 'node:assert/strict';
import test from 'node:test';
import { validateSlideFile, createUploadSession, createSlidePresenter, MAX_FILE_BYTES } from '../src/slides/upload.js';
import { createPresentationState, transitionPresentation } from '../src/state/presentation.js';
import { createManualEvent, parseCommand } from '../src/input/manual.js';
import {slides} from './slides-fixture.js';
import { parseSpeechCommand } from '../src/input/speech.js';

const file = (name = 'slides.pdf', size = 100) => ({name, size, arrayBuffer: async () => new ArrayBuffer(size)});
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => {resolve=a; reject=b;}); return {promise,resolve,reject}; };
const deck = count => ({steps: Array.from({length:count},(_,i)=>({id:`p${i}`})), destroyed:false, destroy(){this.destroyed=true;}});

test('upload bounds reject empty, oversized and unsupported files before parsing', () => {
  assert.equal(validateSlideFile(file('SLIDES.PPTX')), 'pptx');
  assert.equal(validateSlideFile(file('a.pdf')), 'pdf');
  for (const f of [null,file('a.ppt'),file('a.pdf',0),file('a.pdf',MAX_FILE_BYTES+1)]) assert.throws(()=>validateSlideFile(f));
});

test('only the latest upload applies; cancelled or late imports are disposed', async () => {
  const a=deferred(),b=deferred(),c=deferred(), applied=[],messages=[];
  const queue=[a,b,c];let busy;
  const session=createUploadSession({load:()=>queue.shift().promise,canApply:()=>true,onBusy:v=>busy=v,onApply:d=>applied.push(d),onMessage:m=>messages.push(m)});
  const one=session.select(file('one.pdf')),two=session.select(file('two.pptx'));
  const newer=deck(8);b.resolve(newer);await two;assert.equal(busy,false);assert.deepEqual(applied,[newer]);
  const older=deck(3);a.resolve(older);await one;assert.equal(older.destroyed,true);assert.deepEqual(applied,[newer]);
  const three=session.select(file('three.pdf'));session.cancel();const late=deck(4);c.resolve(late);await three;
  assert.equal(late.destroyed,true);assert.equal(session.busy,false);assert.deepEqual(applied,[newer]);
});

test('failed imports preserve current deck and validate page count before applying', async () => {
  const applied=[],messages=[];let result=deck(101);
  const session=createUploadSession({load:async()=>result,canApply:()=>true,onBusy(){},onApply:d=>applied.push(d),onMessage:m=>messages.push(m)});
  await session.select(file());assert.equal(result.destroyed,true);assert.equal(applied.length,0);assert.match(messages.at(-1),/100/);
  result=deck(8);const blocked=createUploadSession({load:async()=>result,canApply:()=>false,onBusy(){},onApply:d=>applied.push(d),onMessage(){}});
  await blocked.select(file());assert.equal(result.destroyed,true);assert.equal(applied.length,0);
});

test('uploaded page count governs manual, voice, camera, detour and restart boundaries', () => {
  let state=createPresentationState();const send=(type,payload={},source='manual')=>state=transitionPresentation(state,{...createManualEvent(type,state,payload),source});
  const epoch=state.sessionEpoch;send('LOAD_DECK',{slides:slides(8)});assert.equal(state.stepCount,8);assert.equal(state.sessionEpoch,epoch+1);
  send('START');for(let i=0;i<7;i++)send('NEXT',{},i%2?'voice':'camera');assert.equal(state.step,7);
  const last=state;send('NEXT');assert.equal(state,last);
  assert.deepEqual(parseCommand('8枚目へ',{stepCount:8}),{type:'REQUEST_JUMP',targetStep:7});
  assert.deepEqual(parseSpeechCommand('相棒、８枚目へ。',{stepCount:8}),{type:'REQUEST_JUMP',targetStep:7});
  assert.equal(parseCommand('9枚目へ',{stepCount:8}),null);
  send('REQUEST_JUMP',{targetStep:0});send('CONFIRM_JUMP');send('RESUME');
  assert.equal(state.step,7);assert.equal(state.resumeSnapshot,null);
  const active=state;send('LOAD_DECK',{slides:slides(2)});assert.equal(state,active);
  send('STOP');send('RESTART');assert.equal(state.stepCount,8);assert.equal(state.step,0);
  send('LOAD_DECK',{slides:slides(1)});send('START');const single=state;send('NEXT');assert.equal(state,single);
  send('STOP');send('RESTART');send('LOAD_DECK',{slides:slides(100)});send('START');
  assert.deepEqual(parseSpeechCommand('100枚目へ',{stepCount:100}),{type:'REQUEST_JUMP',targetStep:99});
  assert.equal(parseCommand('101枚目へ',{stepCount:100}),null);
  send('REQUEST_JUMP',{targetStep:99});send('CONFIRM_JUMP');assert.equal(state.step,99);
  const maximum=state;send('NEXT',{},'camera');assert.equal(state,maximum);
});

test('late slide renders cannot overwrite the latest page and are disposed', async () => {
  const jobs=[deferred(),deferred()], nodes=[];
  const container={ownerDocument:{createElement:()=>({})},replaceChildren(...n){nodes.splice(0,nodes.length,...n);},append(n){nodes.push(n);}};
  const presenter=createSlidePresenter(container,()=>assert.fail('unexpected render error'));
  const input={render:index=>jobs[index].promise};
  const a=presenter.show(input,0),b=presenter.show(input,1);
  let oldDisposed=false,newDisposed=false;
  const latest={element:{page:2},dispose(){newDisposed=true;}};
  jobs[1].resolve(latest);await b;assert.equal(nodes[0],latest.element);
  jobs[0].resolve({element:{page:1},dispose(){oldDisposed=true;}});await a;
  assert.equal(oldDisposed,true);assert.equal(nodes[0],latest.element);presenter.destroy();assert.equal(newDisposed,true);
});
