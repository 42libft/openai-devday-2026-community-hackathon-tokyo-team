/** Fixed scripts and fictional demo data. Camera decisions use the same reducer. */
export const STEPS = Object.freeze([
  Object.freeze({
    id: 'intro',
    title: '発表を始める',
    script: '開いた手で次へ、握り拳で前へ。カメラ画像をAIが判定し、発表を進めます。手を下ろすと次の合図を受け付けます。ボタンでも同じ操作を試せます。',
  }),
  Object.freeze({
    id: 'demo',
    title: '検索デモを見せる',
    script: '架空の作品を検索し、見せたい項目を選びます。質問が出たら移動先を確認して寄り道し、検索と選択を保った元の場面へ戻れます。',
  }),
  Object.freeze({
    id: 'summary',
    title: '発表をまとめる',
    script: '操作は一回取り消せます。寄り道からは元の工程・検索・選択へ復帰できます。最後に停止し、再開するときは明示的にリセットします。',
  }),
]);

export const DEMO_ITEMS = Object.freeze([
  Object.freeze({ id: 'team-board', title: 'チームのアイデア帳', summary: '架空のチームが思いつきを集めて比較する、共有ノートのデモです。' }),
  Object.freeze({ id: 'image-gallery', title: 'まちの色ギャラリー', summary: '架空のまちを題材にした写真とイラストを、色から探す作品デモです。' }),
  Object.freeze({ id: 'event-guide', title: 'イベント案内', summary: '架空の展示会の会場と発表予定を一覧で見られる、案内ページのデモです。' }),
  Object.freeze({ id: 'reading-note', title: '読書メモ', summary: '架空の本の感想と気づきを整理して検索する、個人ノートのデモです。' }),
]);

const EVENT_TYPES = new Set([
  'START', 'NEXT', 'PREVIOUS', 'SEARCH', 'EDIT_QUERY', 'SELECT', 'REQUEST_JUMP',
  'CONFIRM_JUMP', 'CANCEL_JUMP', 'RESUME', 'UNDO', 'STOP', 'RESTART',
]);

const allResultIds = () => DEMO_ITEMS.map((item) => item.id);

// Every snapshot owns its result array, including snapshots inside undo metadata.
function copyFrame(frame) {
  return {
    step: frame.step,
    query: frame.query,
    draftQuery: frame.draftQuery,
    resultIds: [...frame.resultIds],
    selectedId: frame.selectedId,
  };
}

const copyBookmark = (bookmark) => bookmark === null ? null : copyFrame(bookmark);

function copyUndo(snapshot) {
  return snapshot === null ? null : {
    ...copyFrame(snapshot),
    resumeSnapshot: copyBookmark(snapshot.resumeSnapshot),
  };
}

function captureUndo(state) {
  return { ...copyFrame(state), resumeSnapshot: copyBookmark(state.resumeSnapshot) };
}

/** Revision is scoped to the session epoch; a restarted session begins at zero. */
export function createPresentationState() {
  return {
    phase: 'idle',
    step: 0,
    revision: 0,
    sessionEpoch: 1,
    seen: [],
    query: '',
    draftQuery: '',
    resultIds: allResultIds(),
    selectedId: null,
    pendingJump: null,
    resumeSnapshot: null,
    undoSnapshot: null,
    message: '準備ができたら「台本を確認して開始」を押してください。',
  };
}

function validEnvelope(state, event) {
  return event !== null && typeof event === 'object' && !Array.isArray(event)
    && EVENT_TYPES.has(event.type)
    && typeof event.eventId === 'string'
    && event.eventId.length > 0 && event.eventId.length <= 128
    && event.eventId.trim() === event.eventId
    && !/[\u0000-\u001f\u007f]/u.test(event.eventId)
    && !state.seen.includes(event.eventId)
    && Number.isSafeInteger(event.sessionEpoch) && event.sessionEpoch === state.sessionEpoch
    && Number.isSafeInteger(event.baseRevision) && event.baseRevision === state.revision
    && (event.source === 'manual' || event.source === 'synthetic'
      || (event.source === 'voice' && ['NEXT','PREVIOUS','UNDO','RESUME','STOP','REQUEST_JUMP','CONFIRM_JUMP','CANCEL_JUMP'].includes(event.type)
        && state.phase === 'presenting' && (state.pendingJump === null || ['CONFIRM_JUMP','CANCEL_JUMP','STOP'].includes(event.type)))
      || (event.source === 'camera' && ['NEXT', 'PREVIOUS'].includes(event.type)
        && state.phase === 'presenting' && state.pendingJump === null));
}

function accept(state, event, patch) {
  return {
    ...state,
    ...copyFrame(state),
    pendingJump: state.pendingJump === null ? null : { ...state.pendingJump },
    resumeSnapshot: copyBookmark(state.resumeSnapshot),
    undoSnapshot: copyUndo(state.undoSnapshot),
    ...patch,
    revision: state.revision + 1,
    seen: [...state.seen, event.eventId],
  };
}

function changeFrame(state, event, patch) {
  return accept(state, event, {
    pendingJump: null,
    undoSnapshot: captureUndo(state),
    ...patch,
  });
}

const searchText = (text) => text.normalize('NFKC').toLocaleLowerCase('ja');

/**
 * Pure reducer. Rejected input returns the exact original object without changing
 * its revision, message, or history. Only accepted events consume their IDs.
 * Undo covers the most recent frame change; proposals do not replace that undo.
 */
export function transitionPresentation(state, event) {
  if (!validEnvelope(state, event)) return state;

  if (event.type === 'RESTART') {
    if (state.phase !== 'stopped') return state;
    return {
      ...createPresentationState(),
      sessionEpoch: state.sessionEpoch + 1,
      message: '新しい発表の準備ができました。「台本を確認して開始」を押してください。',
    };
  }

  if (state.phase === 'stopped') return state;

  if (event.type === 'STOP') {
    return accept(state, event, {
      phase: 'stopped',
      pendingJump: null,
      message: '停止しました。現在の画面を保持しています。「はじめから」で新しく準備できます。',
    });
  }

  if (event.type === 'START') {
    if (state.phase !== 'idle') return state;
    return accept(state, event, {
      phase: 'presenting',
      step: 0,
      query: '',
      draftQuery: '',
      resultIds: allResultIds(),
      selectedId: null,
      pendingJump: null,
      resumeSnapshot: null,
      undoSnapshot: null,
      message: '発表を開始しました。工程 1 / 3 です。',
    });
  }

  if (state.phase !== 'presenting') return state;

  switch (event.type) {
    case 'NEXT':
    case 'PREVIOUS': {
      const step = state.step + (event.type === 'NEXT' ? 1 : -1);
      if (step < 0 || step >= STEPS.length) return state;
      return changeFrame(state, event, { step, message: `工程 ${step + 1} / ${STEPS.length} に移りました。` });
    }

    case 'EDIT_QUERY': {
      if (typeof event.query !== 'string' || event.query.length > 120 || event.query === state.draftQuery) return state;
      return accept(state, event, { draftQuery: event.query });
    }

    case 'SEARCH': {
      if (typeof event.query !== 'string' || event.query.length > 120) return state;
      const needle = searchText(event.query.trim());
      const resultIds = DEMO_ITEMS.filter((item) =>
        searchText(`${item.title} ${item.summary}`).includes(needle)).map((item) => item.id);
      return changeFrame(state, event, {
        query: event.query,
        draftQuery: event.query,
        resultIds,
        selectedId: null,
        message: resultIds.length === 0 ? '一致する作品はありません。検索語を変えてください。' : `${resultIds.length} 件の作品が見つかりました。`,
      });
    }

    case 'SELECT': {
      if (typeof event.selectedId !== 'string' || !state.resultIds.includes(event.selectedId)
        || state.selectedId === event.selectedId) return state;
      const item = DEMO_ITEMS.find((entry) => entry.id === event.selectedId);
      return changeFrame(state, event, { selectedId: item.id, message: `「${item.title}」を選びました。` });
    }

    case 'REQUEST_JUMP': {
      if (state.resumeSnapshot !== null || !Number.isInteger(event.targetStep)
        || event.targetStep < 0 || event.targetStep >= STEPS.length
        || event.targetStep === state.step || event.targetStep === state.pendingJump?.targetStep) return state;
      return accept(state, event, {
        pendingJump: { targetStep: event.targetStep },
        message: `${event.targetStep + 1}枚目への移動候補です。確認すると寄り道します。`,
      });
    }

    case 'CONFIRM_JUMP': {
      if (state.pendingJump === null || state.resumeSnapshot !== null) return state;
      return changeFrame(state, event, {
        step: state.pendingJump.targetStep,
        query: '',
        draftQuery: '',
        resultIds: allResultIds(),
        selectedId: null,
        resumeSnapshot: copyFrame(state),
        message: '寄り道しました。「続きへ戻る」で工程・検索・選択を復元できます。',
      });
    }

    case 'CANCEL_JUMP':
      if (state.pendingJump === null) return state;
      return accept(state, event, { pendingJump: null, message: '移動候補を取り消しました。現在の場面を続けます。' });

    case 'RESUME':
      if (state.resumeSnapshot === null) return state;
      return changeFrame(state, event, {
        ...copyFrame(state.resumeSnapshot),
        resumeSnapshot: null,
        message: '寄り道前の工程・検索・選択に戻りました。',
      });

    case 'UNDO':
      if (state.undoSnapshot === null) return state;
      return accept(state, event, {
        ...copyFrame(state.undoSnapshot),
        resumeSnapshot: copyBookmark(state.undoSnapshot.resumeSnapshot),
        pendingJump: null,
        undoSnapshot: null,
        message: '直前の操作を一回取り消しました。',
      });

    default:
      return state;
  }
}
