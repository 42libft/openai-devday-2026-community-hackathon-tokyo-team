import test from 'node:test';
import assert from 'node:assert/strict';
import { createPresentationState, transitionPresentation as transition } from '../src/state/presentation.js';

const event = (state, type, source = 'manual', payload = {}) => ({...payload, type, source,
  eventId: crypto.randomUUID(), sessionEpoch: state.sessionEpoch, baseRevision: state.revision});

test('camera can move but cannot start, confirm a detour, search, stop, or restart', () => {
  const idle = createPresentationState();
  assert.equal(transition(idle, event(idle, 'START', 'camera')), idle);
  const active = transition(idle, event(idle, 'START'));
  for (const type of ['START','SEARCH','CONFIRM_JUMP','REQUEST_JUMP','STOP','RESTART','UNDO'])
    assert.equal(transition(active, event(active, type, 'camera')), active);
  const moved = transition(active, event(active, 'NEXT', 'camera'));
  assert.equal(moved.step, 1);
  assert.equal(transition(moved, event(moved, 'PREVIOUS', 'camera')).step, 0);
});

test('camera cannot cancel pending confirmation or apply after undo/stop/restart', () => {
  let active = createPresentationState();
  active = transition(active, event(active, 'START'));
  const delayed = event(active, 'NEXT', 'camera');
  const pending = transition(active, event(active, 'REQUEST_JUMP', 'manual', {targetStep:2}));
  assert.equal(transition(pending, event(pending, 'NEXT', 'camera')), pending);
  const moved = transition(active, event(active, 'NEXT', 'camera'));
  const undone = transition(moved, event(moved, 'UNDO'));
  assert.equal(transition(undone, delayed), undone);
  const stopped = transition(undone, event(undone, 'STOP'));
  assert.equal(transition(stopped, event(stopped, 'NEXT', 'camera')), stopped);
  const reset = transition(stopped, event(stopped, 'RESTART'));
  assert.equal(transition(reset, delayed), reset);
});
