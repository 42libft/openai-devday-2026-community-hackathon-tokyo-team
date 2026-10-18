import assert from 'node:assert/strict';
import test from 'node:test';
import {createController} from '../src/controller.js';
import {createPresentationState, transitionPresentation} from '../src/state/presentation.js';
import {createManualEvent, parseCommand} from '../src/input/manual.js';
import {slides} from './slides-fixture.js';
function setup(render=()=>{}){
  const controller=createController({initialState:createPresentationState(),transition:transitionPresentation,render});
  const send=(type,payload)=>controller.dispatch(createManualEvent(type,controller.getState(),payload));
  return {controller,send};
}
test('import, preview, optional note, start, voice detour and manual resume use one controller',()=>{
  const {controller:c,send}=setup();send('LOAD_DECK',{slides:slides(5)});send('PREVIEW',{targetStep:4});send('EDIT_NOTE',{notes:'補足'});send('START');send('NEXT');
  const intent=parseCommand('5枚目へ',{stepCount:5});c.dispatch({...createManualEvent(intent.type,c.getState(),intent),source:'voice'});
  send('CONFIRM_JUMP');assert.equal(c.getState().step,4);send('RESUME');assert.equal(c.getState().step,1);
  send('UNDO');assert.equal(c.getState().step,4);assert.equal(c.getState().slides[4].notes,'補足');
});
test('render cannot synchronously inject a second transition',()=>{
  let controller;const h=setup(state=>{if(state.step===1)controller.dispatch(createManualEvent('UNDO',state));});controller=h.controller;
  h.send('LOAD_DECK',{slides:slides()});h.send('START');h.send('NEXT');assert.equal(controller.getState().step,1);h.send('UNDO');assert.equal(controller.getState().step,0);
});
