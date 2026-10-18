/** Imported slides are tab-local. Input envelopes also guard deck replacement. */
export const MAX_SLIDES = 100;
const EVENT_TYPES = new Set([
  'LOAD_DECK', 'PREVIEW', 'EDIT_NOTE', 'START', 'NEXT', 'PREVIOUS',
  'REQUEST_JUMP', 'CONFIRM_JUMP', 'CANCEL_JUMP', 'RESUME', 'UNDO', 'STOP', 'RESTART',
]);

export function validSlides(slides) {
  return Array.isArray(slides) && slides.length > 0 && slides.length <= MAX_SLIDES
    && Array.from(slides).every(slide => slide && typeof slide.id === 'string' && slide.id.length > 0
      && typeof slide.title === 'string' && slide.title.length > 0 && slide.title.length <= 200
      && typeof slide.notes === 'string' && slide.notes.length <= 4000)
    && new Set(slides.map(slide => slide.id)).size === slides.length;
}
const copySlides = slides => slides.map(({id, title, notes}) => ({id, title, notes}));
const copyFrame = frame => frame === null ? null : {step: frame.step};
const copyUndo = snapshot => snapshot === null ? null : {
  ...copyFrame(snapshot), resumeSnapshot: copyFrame(snapshot.resumeSnapshot),
};

export function createPresentationState(slides = []) {
  if (slides.length && !validSlides(slides)) throw new Error('資料の形式が正しくありません。');
  return {
    slides: copySlides(slides), stepCount: slides.length, phase: 'idle', step: 0, revision: 0, sessionEpoch: 1,
    seen: [], pendingJump: null, resumeSnapshot: null, undoSnapshot: null,
    message: slides.length ? '内容を確認して発表を開始できます。' : 'PDF / PPTXを読み込んでください。',
  };
}

function validEnvelope(state, event) {
  return event !== null && typeof event === 'object' && !Array.isArray(event)
    && EVENT_TYPES.has(event.type)
    && typeof event.eventId === 'string' && event.eventId.length > 0 && event.eventId.length <= 128
    && event.eventId.trim() === event.eventId && !/[\u0000-\u001f\u007f]/u.test(event.eventId)
    && !state.seen.includes(event.eventId)
    && Number.isSafeInteger(event.sessionEpoch) && event.sessionEpoch === state.sessionEpoch
    && Number.isSafeInteger(event.baseRevision) && event.baseRevision === state.revision
    && (event.source === 'manual' || event.source === 'synthetic'
      || (event.source === 'voice' && ['NEXT','PREVIOUS','UNDO','RESUME','STOP','REQUEST_JUMP','CONFIRM_JUMP','CANCEL_JUMP'].includes(event.type)
        && state.phase === 'presenting' && (state.pendingJump === null || ['CONFIRM_JUMP','CANCEL_JUMP','STOP'].includes(event.type)))
      || (event.source === 'camera' && ['NEXT','PREVIOUS'].includes(event.type)
        && state.phase === 'presenting' && state.pendingJump === null));
}
function accept(state, event, patch) {
  return {...state, pendingJump: state.pendingJump && {...state.pendingJump},
    resumeSnapshot: copyFrame(state.resumeSnapshot), undoSnapshot: copyUndo(state.undoSnapshot),
    ...patch, revision: state.revision + 1, seen: [...state.seen, event.eventId]};
}
function changeFrame(state, event, patch) {
  return accept(state, event, {pendingJump: null,
    undoSnapshot: {...copyFrame(state), resumeSnapshot: copyFrame(state.resumeSnapshot)}, ...patch});
}

/** Rejected input preserves the exact state, including progress and history. */
export function transitionPresentation(state, event) {
  if (!validEnvelope(state, event)) return state;
  if (event.type === 'LOAD_DECK') {
    if (state.phase !== 'idle' || event.source !== 'manual' || !validSlides(event.slides)) return state;
    return {...createPresentationState(event.slides), sessionEpoch: state.sessionEpoch + 1};
  }
  if (event.type === 'RESTART') {
    if (state.phase !== 'stopped') return state;
    return {...createPresentationState(state.slides), sessionEpoch: state.sessionEpoch + 1};
  }
  if (state.phase === 'stopped' || !state.slides.length) return state;
  if (event.type === 'STOP') return accept(state, event, {phase: 'stopped', pendingJump: null,
    message: '発表を終了しました。資料とノートは保持しています。「はじめから」で再準備できます。'});
  if (state.phase === 'idle') {
    if (event.type === 'PREVIEW') {
      if (!Number.isInteger(event.targetStep) || event.targetStep < 0 || event.targetStep >= state.slides.length || event.targetStep === state.step) return state;
      return accept(state, event, {step: event.targetStep, message: `${event.targetStep + 1}枚目を確認中です。`});
    }
    if (event.type === 'EDIT_NOTE') {
      if (typeof event.notes !== 'string' || event.notes.length > 4000 || event.notes === state.slides[state.step].notes) return state;
      const slides = copySlides(state.slides);
      slides[state.step].notes = event.notes;
      return accept(state, event, {slides, message: 'ノートをこのタブに反映しました。再読み込みで消去されます。'});
    }
    if (event.type === 'START') return accept(state, event, {phase: 'presenting', step: 0,
      pendingJump: null, resumeSnapshot: null, undoSnapshot: null,
      message: `発表を開始しました。スライド 1 / ${state.slides.length} です。`});
    return state;
  }
  switch (event.type) {
    case 'NEXT':
    case 'PREVIOUS': {
      const step = state.step + (event.type === 'NEXT' ? 1 : -1);
      if (step < 0 || step >= state.slides.length) return state;
      return changeFrame(state, event, {step, message: `スライド ${step + 1} / ${state.slides.length} に移りました。`});
    }
    case 'REQUEST_JUMP':
      if (state.resumeSnapshot !== null || !Number.isInteger(event.targetStep) || event.targetStep < 0
        || event.targetStep >= state.slides.length || event.targetStep === state.step || event.targetStep === state.pendingJump?.targetStep) return state;
      return accept(state, event, {pendingJump: {targetStep: event.targetStep}, message: `${event.targetStep + 1}枚目への移動候補です。確認すると寄り道します。`});
    case 'CONFIRM_JUMP':
      if (state.pendingJump === null || state.resumeSnapshot !== null) return state;
      return changeFrame(state, event, {step: state.pendingJump.targetStep, resumeSnapshot: copyFrame(state),
        message: '寄り道しました。「続きへ戻る」で元のスライドへ復帰できます。'});
    case 'CANCEL_JUMP':
      if (state.pendingJump === null) return state;
      return accept(state, event, {pendingJump: null, message: '移動候補を取り消しました。現在の場面を続けます。'});
    case 'RESUME':
      if (state.resumeSnapshot === null) return state;
      return changeFrame(state, event, {...copyFrame(state.resumeSnapshot), resumeSnapshot: null, message: '寄り道前のスライドに戻りました。'});
    case 'UNDO':
      if (state.undoSnapshot === null) return state;
      return accept(state, event, {...copyFrame(state.undoSnapshot), resumeSnapshot: copyFrame(state.undoSnapshot.resumeSnapshot),
        pendingJump: null, undoSnapshot: null, message: '直前の移動を一回取り消しました。'});
    default: return state;
  }
}
