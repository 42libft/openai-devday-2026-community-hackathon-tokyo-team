import assert from 'node:assert/strict';
import test from 'node:test';
import { createController } from '../src/controller.js';
import { createPresentationState, transitionPresentation, DEMO_ITEMS } from '../src/state/presentation.js';
import { createManualEvent, parseCommand } from '../src/input/manual.js';

function setup(render = () => {}) {
  const controller = createController({ initialState: createPresentationState(), transition: transitionPresentation, render });
  const send = (type, payload) => controller.dispatch(createManualEvent(type, controller.getState(), payload));
  return { controller, send };
}

function frame(state) {
  return { step: state.step, query: state.query, draftQuery:state.draftQuery, resultIds: state.resultIds, selectedId: state.selectedId };
}

test('real manual input, controller and state complete prepare, advance and one undo', () => {
  const rendered = [];
  const { controller, send } = setup((state) => rendered.push(state.step));
  send('START');
  const ready = frame(controller.getState());
  const command = parseCommand('次へ');
  send(command.type);
  assert.equal(controller.getState().step, 1);
  send('UNDO');
  assert.deepEqual(frame(controller.getState()), ready);
  const restored = controller.getState();
  send('UNDO');
  assert.equal(controller.getState(), restored);
  assert.deepEqual(rendered, [0, 0, 1, 0]);
});

test('full search and selected result return after a confirmed detour and edits', () => {
  const { controller, send } = setup();
  send('START');
  send('NEXT');
  send('SEARCH', { query: DEMO_ITEMS[0].title });
  send('SELECT', { selectedId: DEMO_ITEMS[0].id });
  const before = structuredClone(frame(controller.getState()));
  send('REQUEST_JUMP', { targetStep: 0 });
  assert.deepEqual(frame(controller.getState()), before, 'proposal does not move the stage');
  send('CONFIRM_JUMP');
  send('SEARCH', { query: '検索に一致しないテキスト' });
  send('NEXT');
  send('RESUME');
  assert.deepEqual(frame(controller.getState()), before);
  assert.equal(controller.getState().resumeSnapshot, null);
});

test('replayed and stale events cannot advance after undo or restart', () => {
  const { controller, send } = setup();
  send('START');
  const next = createManualEvent('NEXT', controller.getState());
  controller.dispatch(next);
  send('UNDO');
  const restored = controller.getState();
  controller.dispatch(next);
  assert.equal(controller.getState(), restored);
  send('STOP');
  const stopped = controller.getState();
  send('NEXT');
  assert.equal(controller.getState(), stopped);
  send('RESTART');
  send('START');
  const restarted = controller.getState();
  controller.dispatch(next);
  assert.equal(controller.getState(), restarted);
  assert.notEqual(restarted.sessionEpoch, next.sessionEpoch);
});

test('rendering cannot synchronously inject a second state transition', () => {
  let controller;
  const fixture = setup((state) => {
    if (state.step === 1) controller.dispatch(createManualEvent('UNDO', state));
  });
  controller = fixture.controller;
  fixture.send('START');
  fixture.send('NEXT');
  assert.equal(controller.getState().step, 1);
  fixture.send('UNDO');
  assert.equal(controller.getState().step, 0);
});
