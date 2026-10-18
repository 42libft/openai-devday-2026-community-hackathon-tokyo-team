// Reproducible synthetic decision-event comparison. No camera or API is used.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { CameraDecisionGate } from '../src/input/camera.js';
import { createPresentationState, transitionPresentation } from '../src/state/presentation.js';

const root = new URL('../', import.meta.url);
const sequence = ['NEXT', 'NEXT', 'NONE', 'PREVIOUS', 'PREVIOUS'];
function run(useGate) {
  let state = createPresentationState();
  state = transitionPresentation(state, { type: 'START', source: 'manual', eventId: 'start', sessionEpoch: state.sessionEpoch, baseRevision: state.revision });
  const gate = new CameraDecisionGate(); gate.start();
  let dispatches = 0, moves = 0;
  const events = sequence.map((action, index) => {
    // Each implementation receives the same action/confidence with its own fresh
    // request envelope. Revision rejection is not the difference being measured.
    const request = { requestId: `frame-${index + 1}`, sessionEpoch: state.sessionEpoch, baseRevision: state.revision };
    const decision = { ...request, action, confidence: 0.99 };
    const verdict = useGate ? gate.consume(decision, request, state)
      : action === 'NONE' ? { kind: 'none' } : { kind: 'action', event: { type: action, source: 'camera', eventId: request.requestId, sessionEpoch: request.sessionEpoch, baseRevision: request.baseRevision } };
    const beforeStep = state.step;
    if (verdict.kind === 'action') { dispatches++; state = transitionPresentation(state, verdict.event); }
    if (state.step !== beforeStep) moves++;
    return { action, confidence: 0.99, verdict: verdict.kind, beforeStep, afterStep: state.step, cumulativeMoves: moves };
  });
  return { dispatches, acceptedMoves: moves, finalStep: state.step, finalRevision: state.revision, events };
}
const naive = run(false), gated = run(true);
assert.equal(naive.acceptedMoves, 4); assert.equal(gated.acceptedMoves, 2);
assert.equal(naive.events[1].cumulativeMoves, 2); assert.equal(gated.events[1].cumulativeMoves, 1);
assert.equal(naive.finalStep, 0); assert.equal(gated.finalStep, 0);
const sourceSha256 = {};
for (const file of ['src/input/camera.js', 'src/state/presentation.js', 'api/decide.js']) {
  sourceSha256[file] = createHash('sha256').update(await readFile(new URL(file, root))).digest('hex');
}
const evidence = {
  kind: 'synthetic-decision-event-comparison', generatedAt: new Date().toISOString(),
  command: 'node scripts/gesture-comparison.mjs', sourceSha256,
  input: sequence.map(action => ({ action, confidence: 0.99 })),
  initialStep: 0, stepIndexIsZeroBased: true,
  naive, gated,
  interpretation: 'On the first held NEXT pair, naive moves twice while the existing gate moves once. Confident NONE rearms the gate. Both use the production reducer.',
  limitations: ['Decisions are predetermined, not outputs of a live API call.', 'No camera recognition accuracy, user time saving, or API latency is measured.', 'Both runs finish at the same step; the measured difference is unnecessary intermediate transitions.'],
};
await writeFile(new URL('docs/gesture-comparison.json', root), `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify({ naiveMoves: naive.acceptedMoves, gatedMoves: gated.acceptedMoves, finalSteps: [naive.finalStep, gated.finalStep], evidence: 'docs/gesture-comparison.json' }));
