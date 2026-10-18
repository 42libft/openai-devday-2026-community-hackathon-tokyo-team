import assert from 'node:assert/strict';
import test from 'node:test';
import { commandForKey, createManualEvent, parseCommand } from '../src/input/manual.js';

test('Japanese commands produce only the specified exact intents', () => {
  const commands = {
    NEXT: ['次へ', '次に進む'],
    PREVIOUS: ['前へ', '前に戻る'],
    UNDO: ['取り消し', '取り消す', '今の進行を取り消して'],
    RESUME: ['続きへ', '続きに戻る', '続きに戻ります'],
    STOP: ['停止'],
    START: ['準備', '準備する'],
    RESTART: ['はじめから'],
    CONFIRM_JUMP: ['確認', '移動する'],
    CANCEL_JUMP: ['キャンセル'],
  };
  for (const [type, phrases] of Object.entries(commands)) {
    for (const phrase of phrases) assert.deepEqual(parseCommand(phrase), { type }, phrase);
  }
  for (let slide = 1; slide <= 3; slide += 1) {
    assert.deepEqual(parseCommand(`${slide}枚目へ`), {
      type: 'REQUEST_JUMP', targetStep: slide - 1,
    });
  }
});

test('empty, non-string, unknown, and explanatory inputs have no intent', () => {
  const rejected = [
    undefined, null, 1, {}, ['次へ'], new String('次へ'), '', ' \t\n ',
    '次へ進む予定です', '次へ。', '「次へ」', '前に戻る機能です',
    '続きに戻りますのでお待ちください', '確認してください', '停止したい',
    'NEXT', 'constructor', '__proto__', '0枚目へ', '4枚目へ', '12枚目へ',
    '1枚目へ移動', '第1枚目へ', '検索', '検索   ', '検索語',
  ];
  for (const value of rejected) assert.equal(parseCommand(value), null, String(value));
});

test('NFKC and surrounding whitespace are accepted without fuzzy matching', () => {
  assert.deepEqual(parseCommand(' \t次へ\n'), { type: 'NEXT' });
  assert.deepEqual(parseCommand('　２枚目へ　'), { type: 'REQUEST_JUMP', targetStep: 1 });
  assert.deepEqual(parseCommand('ｷｬﾝｾﾙ'), { type: 'CANCEL_JUMP' });
  assert.deepEqual(parseCommand('検索　ＡＢＣ　資料 '), { type: 'SEARCH', query: 'ABC 資料' });
  assert.equal(parseCommand('次 へ'), null);
  assert.equal(parseCommand('次\u200bへ'), null);
});

test('search requires a separator and a nonempty query of at most 120 characters', () => {
  assert.deepEqual(parseCommand('検索 説明 用語'), { type: 'SEARCH', query: '説明 用語' });
  assert.deepEqual(parseCommand('検索\t資料'), { type: 'SEARCH', query: '資料' });
  assert.deepEqual(parseCommand(`検索 ${'語'.repeat(120)}`), {
    type: 'SEARCH', query: '語'.repeat(120),
  });
  assert.equal(parseCommand(`検索 ${'語'.repeat(121)}`), null);
  assert.equal(parseCommand(`検索 ${'㍿'.repeat(31)}`), null, 'NFKC expansion also respects the query limit');
  assert.equal(parseCommand('検索:資料'), null);
});

test('the total input limit is enforced before trimming and after normalization', () => {
  assert.deepEqual(parseCommand(`${' '.repeat(178)}次へ`), { type: 'NEXT' });
  assert.equal(parseCommand(`${' '.repeat(179)}次へ`), null);
  assert.equal(parseCommand(`検索 ${'㍿'.repeat(50)}`), null);
  assert.equal(parseCommand('あ'.repeat(181)), null);
});

test('manual event metadata cannot be overridden by payload and inputs stay unchanged', () => {
  const state = Object.freeze({ sessionEpoch: 7, revision: 12 });
  const payload = Object.freeze({
    type: 'STOP', eventId: 'forged', sessionEpoch: -1, baseRevision: -1,
    source: 'sensor', targetStep: 2, query: '資料',
  });
  const action = createManualEvent('REQUEST_JUMP', state, payload);
  assert.deepEqual({ ...action, eventId: 'generated' }, {
    type: 'REQUEST_JUMP', eventId: 'generated', sessionEpoch: 7,
    baseRevision: 12, source: 'manual', targetStep: 2, query: '資料',
  });
  assert.match(action.eventId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
  assert.equal(payload.eventId, 'forged');
  assert.equal(state.revision, 12);
});

test('each manual action has a fresh identity and captures the current state revision', () => {
  const state = { sessionEpoch: 1, revision: 0 };
  const first = createManualEvent('NEXT', state);
  state.revision = 1;
  const second = createManualEvent('NEXT', state);
  assert.notEqual(first, second);
  assert.notEqual(first.eventId, second.eventId);
  assert.equal(first.baseRevision, 0);
  assert.equal(second.baseRevision, 1);
  assert.equal(first.sessionEpoch, 1);
  assert.equal(first.source, 'manual');
});

test('only documented keyboard shortcuts create intents and space remains native', () => {
  const keys = {
    ArrowRight: 'NEXT', PageDown: 'NEXT', ArrowLeft: 'PREVIOUS', PageUp: 'PREVIOUS',
    Escape: 'CANCEL_JUMP', u: 'UNDO', U: 'UNDO', r: 'RESUME', R: 'RESUME',
  };
  for (const [key, type] of Object.entries(keys)) {
    assert.deepEqual(commandForKey({ key }), { type }, key);
  }
  for (const key of [' ', 'Space', 'Spacebar', 'Enter', 'ArrowDown', 'Home', 'x']) {
    assert.equal(commandForKey({ key }), null, key);
  }
  assert.deepEqual(commandForKey({ key: 'U', shiftKey: true }), { type: 'UNDO' });
  assert.equal(commandForKey(null), null);
  assert.equal(commandForKey(undefined), null);
});

test('repeat, composition, prevented events, and modifier combinations are ignored', () => {
  for (const flag of ['repeat', 'isComposing', 'defaultPrevented', 'ctrlKey', 'metaKey', 'altKey']) {
    for (const key of ['ArrowRight', 'Escape', 'u', 'R']) {
      assert.equal(commandForKey({ key, [flag]: true }), null, `${key}: ${flag}`);
    }
  }
});

test('editable targets and their descendants suppress shortcuts', () => {
  assert.equal(commandForKey({ key: 'ArrowRight', target: { isContentEditable: true } }), null);
  for (const editor of ['input', 'textarea', 'select', 'contenteditable']) {
    const target = {
      closest(selector) {
        assert.ok(selector.includes(editor), `selector identifies ${editor}`);
        return { editor };
      },
    };
    assert.equal(commandForKey({ key: 'ArrowRight', target }), null, editor);
    assert.equal(commandForKey({ key: 'u', target: { nodeType: 3, parentElement: target } }), null);
  }
  const button = { closest: () => null };
  assert.deepEqual(commandForKey({ key: 'ArrowRight', target: button }), { type: 'NEXT' });
  assert.equal(commandForKey({ key: ' ', target: button }), null);
});

test('keyboard helpers have no browser-event side effects', () => {
  const event = Object.freeze({
    key: 'ArrowRight', target: Object.freeze({ closest: () => null }),
    preventDefault: () => assert.fail('the caller owns preventDefault'),
    stopPropagation: () => assert.fail('the caller owns propagation'),
  });
  assert.deepEqual(commandForKey(event), { type: 'NEXT' });
  assert.deepEqual(commandForKey(event), { type: 'NEXT' });
});
