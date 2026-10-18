import assert from 'node:assert/strict';
import test from 'node:test';
import { DEMO_ITEMS, STEPS, createPresentationState, transitionPresentation } from '../src/state/presentation.js';

let eventSequence = 0;
const allIds = DEMO_ITEMS.map((item) => item.id);
const envelope = (state, type, payload = {}) => ({
  type, eventId: `event-${++eventSequence}`, sessionEpoch: state.sessionEpoch,
  baseRevision: state.revision, source: 'manual', ...payload,
});
const act = (state, type, payload = {}) => transitionPresentation(state, envelope(state, type, payload));
const start = () => act(createPresentationState(), 'START');
const frame = ({ step, query, resultIds, selectedId }) => ({ step, query, resultIds, selectedId });

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

test('three scripted steps run forward/backward within bounds, with a single undo', () => {
  assert.deepEqual(STEPS.map((step) => step.id), ['intro', 'demo', 'summary']);
  assert.ok(STEPS.every((step) => step.title && step.script));
  let state = createPresentationState();
  assert.equal(state.phase, 'idle');
  assert.equal(state.sessionEpoch, 1);
  assert.equal(state.revision, 0);
  assert.deepEqual(state.resultIds, allIds);
  for (const type of ['NEXT', 'PREVIOUS', 'SEARCH', 'UNDO', 'RESUME', 'RESTART']) {
    assert.equal(act(state, type, { query: '' }), state);
  }
  state = act(state, 'START');
  assert.equal(state.phase, 'presenting');
  assert.equal(state.revision, 1);
  assert.equal(act(state, 'PREVIOUS'), state);
  assert.equal(act(state, 'START'), state);
  state = act(state, 'NEXT');
  assert.equal(state.step, 1);
  state = act(state, 'NEXT');
  assert.equal(state.step, 2);
  assert.equal(act(state, 'NEXT'), state);
  state = act(state, 'UNDO');
  assert.equal(state.step, 1);
  assert.equal(act(state, 'UNDO'), state);
  state = act(state, 'PREVIOUS');
  assert.equal(state.step, 0);
});

test('malformed, duplicate, stale, and unsupported event envelopes cannot change state', () => {
  let state = start();
  const invalid = [
    null, undefined, [], {},
    { eventId: '' }, { eventId: ' ' }, { eventId: ' leading' },
    { eventId: 'bad\ninput' }, { eventId: 'x'.repeat(129) }, { eventId: 1 },
    { baseRevision: state.revision - 1 }, { baseRevision: state.revision + 1 },
    { baseRevision: undefined }, { baseRevision: '1' },
    { sessionEpoch: 0 }, { sessionEpoch: undefined },
    { source: 'voice' }, { source: undefined }, { type: 'AUTOPLAY' },
  ];
  for (const patch of invalid) {
    const event = patch === null || patch === undefined || Array.isArray(patch) || Object.keys(patch).length === 0
      ? patch : envelope(state, 'NEXT', patch);
    assert.equal(transitionPresentation(state, event), state);
  }
  const next = envelope(state, 'NEXT');
  state = transitionPresentation(state, next);
  const progressed = state;
  assert.equal(transitionPresentation(state, { ...next, baseRevision: state.revision }), state, 'duplicate ID remains invalid with a fresh revision');
  state = act(state, 'UNDO');
  assert.equal(transitionPresentation(state, { ...next, baseRevision: state.revision }), state, 'undo does not permit replay');
  assert.equal(transitionPresentation(state, envelope(progressed, 'NEXT')), state, 'old revisions cannot replay after undo');
  state = act(state, 'NEXT', { source: 'synthetic' });
  assert.equal(state.step, 1);
});

test('search validates payloads, clears selection, and has predictable empty/no-result behavior', () => {
  let state = start();
  for (const query of [null, undefined, 42, [], 'x'.repeat(121)]) {
    assert.equal(act(state, 'SEARCH', { query }), state);
  }
  state = act(state, 'SEARCH', { query: '写真' });
  assert.deepEqual(state.resultIds, ['image-gallery']);
  assert.equal(act(state, 'SELECT', { selectedId: 'event-guide' }), state);
  assert.equal(act(state, 'SELECT', { selectedId: null }), state);
  state = act(state, 'SELECT', { selectedId: 'image-gallery' });
  assert.equal(state.selectedId, 'image-gallery');
  assert.equal(act(state, 'SELECT', { selectedId: 'image-gallery' }), state);
  state = act(state, 'SEARCH', { query: '該当作品のない検索語' });
  assert.deepEqual(state.resultIds, []);
  assert.equal(state.selectedId, null);
  assert.match(state.message, /ありません/);
  assert.equal(act(state, 'SELECT', { selectedId: 'image-gallery' }), state);
  state = act(state, 'SEARCH', { query: '' });
  assert.deepEqual(state.resultIds, allIds);
  state = act(state, 'SEARCH', { query: '　 ' });
  assert.deepEqual(state.resultIds, allIds);
});

test('confirmed detour restores the complete original frame after searching and stepping away', () => {
  let state = act(start(), 'NEXT');
  state = act(state, 'SEARCH', { query: '写真' });
  state = act(state, 'SELECT', { selectedId: 'image-gallery' });
  const original = structuredClone(frame(state));
  const beforeProposal = state;
  state = act(state, 'REQUEST_JUMP', { targetStep: 2 });
  assert.deepEqual(frame(state), original, 'a proposal does not move the frame');
  assert.equal(state.resumeSnapshot, null);
  assert.deepEqual(state.pendingJump, { targetStep: 2 });
  assert.equal(transitionPresentation(state, envelope(beforeProposal, 'CONFIRM_JUMP')), state, 'confirmation requires the current revision');
  state = act(state, 'CONFIRM_JUMP');
  assert.equal(state.step, 2);
  assert.equal(state.query, '');
  assert.deepEqual(state.resultIds, allIds);
  assert.equal(state.selectedId, null);
  assert.deepEqual(state.resumeSnapshot, original);
  assert.equal(act(state, 'REQUEST_JUMP', { targetStep: 0 }), state, 'nested detours are rejected');
  state = act(state, 'SEARCH', { query: 'ノート' });
  state = act(state, 'SELECT', { selectedId: 'reading-note' });
  state = act(state, 'PREVIOUS');
  state = act(state, 'PREVIOUS');
  state = act(state, 'NEXT');
  assert.deepEqual(state.resumeSnapshot, original, 'ordinary operations never replace the return bookmark');
  state = act(state, 'RESUME');
  assert.deepEqual(frame(state), original);
  assert.equal(state.resumeSnapshot, null);
  assert.equal(state.pendingJump, null);
  assert.equal(act(state, 'RESUME'), state);
});

test('search and selection undo each restore the last frame exactly once', () => {
  let state = act(start(), 'SEARCH', { query: '写真' });
  const searched = structuredClone(frame(state));
  state = act(state, 'SELECT', { selectedId: 'image-gallery' });
  state = act(state, 'UNDO');
  assert.deepEqual(frame(state), searched);
  assert.equal(state.undoSnapshot, null);
  assert.equal(act(state, 'UNDO'), state);
  state = act(state, 'SELECT', { selectedId: 'image-gallery' });
  const selected = structuredClone(frame(state));
  state = act(state, 'SEARCH', { query: 'ノート' });
  state = act(state, 'UNDO');
  assert.deepEqual(frame(state), selected);
});

test('undo of jump removes its bookmark; undo of resume restores detour plus original bookmark', () => {
  let state = act(start(), 'SEARCH', { query: '写真' });
  state = act(state, 'SELECT', { selectedId: 'image-gallery' });
  const original = structuredClone(frame(state));
  state = act(state, 'REQUEST_JUMP', { targetStep: 2 });
  state = act(state, 'CONFIRM_JUMP');
  state = act(state, 'UNDO');
  assert.deepEqual(frame(state), original);
  assert.equal(state.resumeSnapshot, null);
  assert.equal(state.pendingJump, null);
  assert.equal(act(state, 'UNDO'), state);

  state = act(state, 'REQUEST_JUMP', { targetStep: 1 });
  state = act(state, 'CONFIRM_JUMP');
  state = act(state, 'SEARCH', { query: '案内' });
  state = act(state, 'SELECT', { selectedId: 'event-guide' });
  const detour = structuredClone(frame(state));
  state = act(state, 'RESUME');
  assert.deepEqual(frame(state), original);
  state = act(state, 'UNDO');
  assert.deepEqual(frame(state), detour);
  assert.deepEqual(state.resumeSnapshot, original);
  assert.equal(act(state, 'UNDO'), state, 'undo cannot toggle back to resumed state');
  state = act(state, 'RESUME');
  assert.deepEqual(frame(state), original);
});

test('jump cancellation and intervening frame changes invalidate pending confirmations', () => {
  let state = start();
  for (const targetStep of [-1, 3, 0, 1.5, '1', null, undefined]) {
    assert.equal(act(state, 'REQUEST_JUMP', { targetStep }), state);
  }
  assert.equal(act(state, 'CONFIRM_JUMP'), state);
  assert.equal(act(state, 'CANCEL_JUMP'), state);
  state = act(state, 'REQUEST_JUMP', { targetStep: 2 });
  const staleConfirmation = envelope(state, 'CONFIRM_JUMP');
  state = act(state, 'CANCEL_JUMP');
  assert.equal(state.pendingJump, null);
  assert.equal(transitionPresentation(state, staleConfirmation), state);
  assert.equal(act(state, 'CONFIRM_JUMP'), state);

  for (const [type, payload] of [
    ['NEXT', {}], ['SEARCH', { query: '写真' }],
    ['SELECT', { selectedId: 'image-gallery' }], ['UNDO', {}],
  ]) {
    state = act(state, 'REQUEST_JUMP', { targetStep: 2 });
    const confirm = envelope(state, 'CONFIRM_JUMP');
    state = act(state, type, payload);
    assert.equal(state.pendingJump, null, type);
    assert.equal(transitionPresentation(state, confirm), state, type);
    assert.equal(act(state, 'CONFIRM_JUMP'), state, type);
  }
});

test('stop freezes the frame and cancels candidates; restart rejects previous-session inputs', () => {
  let state = act(start(), 'SEARCH', { query: '写真' });
  state = act(state, 'SELECT', { selectedId: 'image-gallery' });
  const original = structuredClone(frame(state));
  state = act(state, 'REQUEST_JUMP', { targetStep: 2 });
  const queued = envelope(state, 'CONFIRM_JUMP');
  state = act(state, 'STOP');
  assert.equal(state.phase, 'stopped');
  assert.deepEqual(frame(state), original);
  assert.equal(state.pendingJump, null);
  for (const type of ['START', 'NEXT', 'PREVIOUS', 'SEARCH', 'SELECT', 'REQUEST_JUMP', 'CONFIRM_JUMP', 'CANCEL_JUMP', 'RESUME', 'UNDO', 'STOP']) {
    assert.equal(act(state, type, { query: '', selectedId: 'team-board', targetStep: 1 }), state, type);
  }
  assert.equal(transitionPresentation(state, queued), state);
  const oldEpoch = state.sessionEpoch;
  state = act(state, 'RESTART');
  assert.equal(state.phase, 'idle');
  assert.equal(state.sessionEpoch, oldEpoch + 1);
  assert.equal(state.revision, 0);
  assert.deepEqual(state.seen, []);
  assert.equal(state.resumeSnapshot, null);
  assert.equal(state.undoSnapshot, null);
  assert.deepEqual(frame(state), frame(createPresentationState()));
  assert.equal(transitionPresentation(state, { ...queued, type: 'START', baseRevision: 0 }), state);
  state = act(state, 'START');
  assert.equal(state.phase, 'presenting');
  assert.equal(act(state, 'RESTART'), state);
});

test('frozen inputs stay unchanged and all result arrays/bookmarks are independent copies', () => {
  const first = createPresentationState();
  const second = createPresentationState();
  assert.notEqual(first.resultIds, second.resultIds);
  let state = deepFreeze(first);
  for (const [type, payload] of [
    ['START', {}], ['SEARCH', { query: '写真' }], ['SELECT', { selectedId: 'image-gallery' }],
    ['REQUEST_JUMP', { targetStep: 2 }], ['CONFIRM_JUMP', {}], ['SEARCH', { query: 'ノート' }],
    ['SELECT', { selectedId: 'reading-note' }], ['PREVIOUS', {}], ['RESUME', {}],
    ['UNDO', {}], ['RESUME', {}], ['STOP', {}], ['RESTART', {}],
  ]) {
    const before = structuredClone(state);
    const event = deepFreeze(envelope(state, type, payload));
    const next = transitionPresentation(state, event);
    assert.notEqual(next, state, type);
    assert.deepEqual(state, before, type);
    assert.notEqual(next.resultIds, state.resultIds, type);
    if (next.resumeSnapshot) {
      assert.notEqual(next.resumeSnapshot.resultIds, next.resultIds);
      if (state.resumeSnapshot) assert.notEqual(next.resumeSnapshot.resultIds, state.resumeSnapshot.resultIds);
    }
    if (next.undoSnapshot) {
      assert.notEqual(next.undoSnapshot.resultIds, state.resultIds);
      if (next.undoSnapshot.resumeSnapshot) {
        assert.notEqual(next.undoSnapshot.resumeSnapshot.resultIds, next.resumeSnapshot?.resultIds);
      }
    }
    state = deepFreeze(next);
  }
  assert.equal(first.phase, 'idle');
  assert.deepEqual(first.seen, []);
  assert.deepEqual(second.resultIds, allIds);
});
