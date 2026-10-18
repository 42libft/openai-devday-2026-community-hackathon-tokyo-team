import assert from 'node:assert/strict';
import test from 'node:test';
import { createScriptStore } from '../src/script/storage.js';

const key = 'presentation-companion.script.v1';
const defaults = () => ['intro', 'demo', 'summary'].map((id, index) => ({
  id, title: `工程${index + 1}`, script: `台本${index + 1}`,
}));

function storageFixture(initial = null) {
  let raw = initial;
  let writes = 0;
  const storage = {
    getItem(name) { assert.equal(name, key); return raw; },
    setItem(name, value) { assert.equal(name, key); raw = value; writes += 1; },
  };
  return { storage, get raw() { return raw; }, get writes() { return writes; } };
}

test('sample loads are independent copies and do not write to storage', () => {
  const input = defaults();
  const fixture = storageFixture();
  const store = createScriptStore(input, { getStorage: () => fixture.storage });
  input[0].title = '外から変更';
  const first = store.load();
  assert.equal(first.source, 'sample');
  assert.deepEqual(first.steps, defaults());
  first.steps[0].script = '返り値を変更';
  first.steps.pop();
  assert.deepEqual(store.load().steps, defaults());
  assert.equal(fixture.writes, 0);
});

test('save trims edges, preserves internal newlines and reloads in a new store', () => {
  const fixture = storageFixture();
  const store = createScriptStore(defaults(), { getStorage: () => fixture.storage });
  const input = defaults();
  input[0].title = '  編集した工程  ';
  input[0].script = '\n  最初の行\n\n  次の行\r\n最後の行 \n';
  const saved = store.save(input);
  const expected = defaults();
  expected[0] = { id: 'intro', title: '編集した工程', script: '最初の行\n\n  次の行\r\n最後の行' };
  assert.deepEqual(saved, {
    steps: expected, source: 'saved', persisted: true, message: '台本をこのブラウザに保存しました。',
  });
  assert.deepEqual(JSON.parse(fixture.raw), { version: 1, steps: expected });
  input[0].title = '入力を変更';
  saved.steps[0].script = '返り値を変更';
  const freshStore = createScriptStore(defaults(), { getStorage: () => fixture.storage });
  const loaded = freshStore.load();
  assert.equal(loaded.source, 'saved');
  assert.deepEqual(loaded.steps, expected);
  loaded.steps[0].title = '読込結果を変更';
  assert.deepEqual(freshStore.load().steps, expected);
});

test('valid length boundaries are saved and invalid input never touches storage', () => {
  const fixture = storageFixture();
  let accesses = 0;
  const store = createScriptStore(defaults(), { getStorage: () => { accesses += 1; return fixture.storage; } });
  const boundary = defaults();
  boundary[0].title = 'あ'.repeat(80);
  boundary[0].script = '文'.repeat(4000);
  boundary[1].title = '題';
  boundary[1].script = '文';
  assert.equal(store.save(boundary).persisted, true);
  const original = fixture.raw;
  const invalidInputs = [null, [], defaults().slice(0, 2), [...defaults(), defaults()[0]], Array(3)];
  for (const [field, value] of [
    ['title', ''], ['title', '  \n'], ['title', '題'.repeat(81)], ['title', 1],
    ['script', ''], ['script', '  \n'], ['script', '文'.repeat(4001)], ['script', null],
    ['id', 'other'],
  ]) {
    const input = defaults();
    input[0][field] = value;
    invalidInputs.push(input);
  }
  invalidInputs.push(defaults().reverse());
  const extra = defaults(); extra[0].unexpected = true; invalidInputs.push(extra);
  const missing = defaults(); delete missing[0].script; invalidInputs.push(missing);
  for (const input of invalidInputs) {
    assert.throws(() => store.save(input), /工程|台本|タイトル/);
    assert.equal(fixture.raw, original);
  }
  assert.equal(accesses, 1);
  assert.equal(fixture.writes, 1);
});

test('corrupt, unknown-version, malformed and oversized saved data falls back without overwriting', () => {
  const wrongId = defaults(); wrongId[1].id = 'intro';
  const longScript = defaults(); longScript[0].script = '文'.repeat(4001);
  const wrongType = defaults(); wrongType[0].title = 42;
  const extraField = defaults(); extraField[0].extra = true;
  const invalidValues = [
    '', '{broken', 'null', '[]', 'x'.repeat(100_001),
    JSON.stringify({ version: 2, steps: defaults() }),
    JSON.stringify({ version: '1', steps: defaults() }),
    JSON.stringify({ version: 1, steps: defaults(), extra: true }),
    ...[wrongId, longScript, wrongType, extraField, defaults().reverse(), defaults().slice(0, 2)]
      .map((steps) => JSON.stringify({ version: 1, steps })),
  ];
  for (const raw of invalidValues) {
    const fixture = storageFixture(raw);
    const result = createScriptStore(defaults(), { getStorage: () => fixture.storage }).load();
    assert.equal(result.source, 'sample');
    assert.deepEqual(result.steps, defaults());
    assert.match(result.message, /保存済みデータは変更していません/);
    assert.equal(fixture.raw, raw);
    assert.equal(fixture.writes, 0);
  }
});

test('unavailable storage and throwing accessors are caught on load and save', () => {
  for (const getStorage of [
    () => { throw new DOMException('blocked', 'SecurityError'); },
    () => undefined,
    () => ({ getItem() { throw new Error('read blocked'); }, setItem() { throw new Error('write blocked'); } }),
  ]) {
    const store = createScriptStore(defaults(), { getStorage });
    const loaded = store.load();
    assert.equal(loaded.source, 'sample');
    assert.deepEqual(loaded.steps, defaults());
    assert.match(loaded.message, /読み取れない/);
    const input = defaults(); input[0].title = '編集';
    const saved = store.save(input);
    assert.equal(saved.source, 'memory');
    assert.equal(saved.persisted, false);
    assert.deepEqual(saved.steps, input);
    assert.match(saved.message, /再読み込みすると失われます/);
    input[0].title = '後から変更';
    assert.equal(saved.steps[0].title, '編集');
  }
});

test('quota failure keeps prior saved data and returns the edited text for this screen', () => {
  const previous = JSON.stringify({ version: 1, steps: defaults() });
  const store = createScriptStore(defaults(), { getStorage: () => ({
    getItem: () => previous,
    setItem() { throw new DOMException('full', 'QuotaExceededError'); },
  }) });
  const input = defaults(); input[1].script = '  今の画面用\n変更した台本  ';
  const saved = store.save(input);
  assert.equal(saved.source, 'memory');
  assert.equal(saved.persisted, false);
  assert.equal(saved.steps[1].script, '今の画面用\n変更した台本');
  assert.match(saved.message, /保存容量が不足/);
  assert.match(saved.message, /再読み込みすると失われます/);
  assert.deepEqual(store.load().steps, defaults());
});
