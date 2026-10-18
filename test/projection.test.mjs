import assert from 'node:assert/strict';
import test from 'node:test';
import { createProjectionController } from '../src/projection/controller.js';
import { createPresentationState, transitionPresentation } from '../src/state/presentation.js';
import { createManualEvent } from '../src/input/manual.js';

function harness() {
  let phase='presenting', fullscreen=false, supported=true, enters=0, exits=0, requests=0, stops=0;
  const messages=[];
  let request=async()=>{fullscreen=true;}, exit=async()=>{fullscreen=false;};
  const mode=createProjectionController({getPhase:()=>phase,canFullscreen:()=>supported,isFullscreen:()=>fullscreen,
    requestFullscreen:()=>{requests++;return request();},exitFullscreen:()=>{stops++;return exit();},
    onEnter:()=>enters++,onExit:()=>exits++,onMessage:m=>messages.push(m)});
  return {mode,messages,set phase(v){phase=v;},set supported(v){supported=v;},set fullscreen(v){fullscreen=v;},
    set request(v){request=v;},set exit(v){exit=v;},get counts(){return {enters,exits,requests,stops};}};
}

test('dedicated view requires an active presentation and can leave without fullscreen support',async()=>{
  const h=harness();h.phase='idle';await h.mode.open();assert.equal(h.mode.active,false);assert.equal(h.counts.enters,0);
  h.phase='presenting';h.supported=false;await h.mode.open();assert.equal(h.mode.active,true);await h.mode.close();
  assert.deepEqual(h.counts,{enters:1,exits:1,requests:0,stops:0});
});

test('unsupported and rejected fullscreen leave the normal view usable',async()=>{
  const h=harness();h.supported=false;await h.mode.open({fullscreen:true});assert.equal(h.mode.active,false);assert.equal(h.counts.enters,0);
  h.supported=true;h.request=()=>Promise.reject(new Error('Denied'));await h.mode.open({fullscreen:true});
  assert.equal(h.mode.active,false);assert.equal(h.counts.enters,1);assert.equal(h.counts.exits,1);assert.equal(h.messages.length,2);
});

test('browser fullscreen exit restores the normal view exactly once',async()=>{
  const h=harness();await h.mode.open({fullscreen:true});assert.equal(h.mode.active,true);
  h.mode.fullscreenChanged();h.fullscreen=false;h.mode.fullscreenChanged();h.mode.fullscreenChanged();await h.mode.close();
  assert.equal(h.counts.exits,1);assert.equal(h.mode.active,false);
});

test('a late fullscreen request cannot reopen a closed view',async()=>{
  const h=harness();let resolve;h.request=()=>new Promise(r=>resolve=r);
  const opening=h.mode.open({fullscreen:true});assert.equal(h.mode.pending,true);
  await h.mode.close();await h.mode.open();assert.equal(h.mode.active,false,'new view waits until the old request settles');
  h.fullscreen=true;resolve();await opening;assert.equal(h.mode.active,false);assert.equal(h.counts.stops,1);
  await h.mode.open();assert.equal(h.mode.active,true);
});

test('failed native exit retains exit and manual controls; browser exit still cleans up',async()=>{
  const h=harness();await h.mode.open({fullscreen:true});h.exit=()=>Promise.reject(new Error('Denied'));
  await h.mode.close();assert.equal(h.mode.active,true);assert.equal(h.counts.exits,0);assert.match(h.messages.at(-1),/Esc/);
  h.fullscreen=false;h.mode.fullscreenChanged();assert.equal(h.mode.active,false);assert.equal(h.counts.exits,1);
});

test('display switches preserve page, bookmark, revision and input ownership while progression stays live',async()=>{
  let state=createPresentationState(8), inputMode='camera';
  const send=(type,payload={},source='manual')=>state=transitionPresentation(state,{...createManualEvent(type,state,payload),source});
  send('START');send('NEXT');send('REQUEST_JUMP',{targetStep:7});send('CONFIRM_JUMP');const snapshot=state;
  const mode=createProjectionController({getPhase:()=>state.phase,canFullscreen:()=>false,isFullscreen:()=>false,
    requestFullscreen(){throw new Error('No request');},exitFullscreen(){},onEnter(){},onExit(){},onMessage(){}});
  await mode.open();assert.equal(state,snapshot);assert.equal(inputMode,'camera');
  send('PREVIOUS',{},'camera');assert.equal(state.step,6);send('RESUME',{},'voice');assert.equal(state.step,1);
  const resumed=state;await mode.close();assert.equal(state,resumed);assert.equal(inputMode,'camera');
  await mode.open();send('STOP');mode.phaseChanged();assert.equal(mode.active,false);assert.equal(state.phase,'stopped');
});
