const COMMAND_TYPES = new Map([
  ['次へ', 'NEXT'],
  ['次に進む', 'NEXT'],
  ['前へ', 'PREVIOUS'],
  ['前に戻る', 'PREVIOUS'],
  ['取り消し', 'UNDO'],
  ['取り消す', 'UNDO'],
  ['今の進行を取り消して', 'UNDO'],
  ['続きへ', 'RESUME'],
  ['続きに戻る', 'RESUME'],
  ['続きに戻ります', 'RESUME'],
  ['停止', 'STOP'],
  ['準備', 'START'],
  ['準備する', 'START'],
  ['はじめから', 'RESTART'],
  ['確認', 'CONFIRM_JUMP'],
  ['移動する', 'CONFIRM_JUMP'],
  ['キャンセル', 'CANCEL_JUMP'],
]);

const KEY_TYPES = new Map([
  ['ArrowRight', 'NEXT'],
  ['PageDown', 'NEXT'],
  ['ArrowLeft', 'PREVIOUS'],
  ['PageUp', 'PREVIOUS'],
  ['Escape', 'CANCEL_JUMP'],
  ['u', 'UNDO'],
  ['U', 'UNDO'],
  ['r', 'RESUME'],
  ['q', 'STOP'],
  ['Q', 'STOP'],
  ['R', 'RESUME'],
]);

const EDITABLE_SELECTOR =
  'input, textarea, select, [contenteditable=""], [contenteditable="true" i], [contenteditable="plaintext-only" i]';

/** Capture the current state version when a manual action is created. */
export function createManualEvent(type, state, payload = {}) {
  return {
    ...payload,
    type,
    eventId: crypto.randomUUID(),
    sessionEpoch: state.sessionEpoch,
    baseRevision: state.revision,
    source: 'manual',
  };
}

/** Parse only explicit commands; explanatory sentences have no action. */
export function parseCommand(text, { stepCount = 0 } = {}) {
  if (typeof text !== 'string' || text.length > 180) return null;

  const command = text.normalize('NFKC').trim();
  if (!command || command.length > 180) return null;

  const type = COMMAND_TYPES.get(command);
  if (type) return { type };

  const jump = /^([1-9]\d{0,2})枚目へ$/u.exec(command);
  if (jump) return Number(jump[1]) <= stepCount
    ? { type: 'REQUEST_JUMP', targetStep: Number(jump[1]) - 1 } : null;

  return null;
}

/** Return an intent without handling the browser event or dispatching it. */
export function commandForKey(event) {
  if (!event || event.repeat || event.isComposing || event.defaultPrevented
      || event.ctrlKey || event.metaKey || event.altKey) return null;

  // Text-node targets have no closest(); their parent still identifies editors.
  const target = event.target?.nodeType === 3 ? event.target.parentElement : event.target;
  if (target?.isContentEditable || target?.closest?.(EDITABLE_SELECTOR)) return null;

  const type = KEY_TYPES.get(event.key);
  return type ? { type } : null;
}
