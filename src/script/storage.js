const STORAGE_KEY = 'presentation-companion.script.v1';
const MAX_STORED_LENGTH = 100_000;
const copySteps = (steps) => steps.map(({ id, title, script }) => ({ id, title, script }));

function hasExactKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && keys.every((key) => Object.hasOwn(value, key));
}

function normalizeSteps(input, expectedIds) {
  if (!Array.isArray(input) || input.length !== 3) {
    throw new Error('台本は3工程すべて入力してください。');
  }
  const steps = Array.from(input, (step, index) => {
    if (!hasExactKeys(step, ['id', 'title', 'script'])
      || typeof step.id !== 'string' || !step.id || step.id.length > 128
      || step.id.trim() !== step.id
      || (expectedIds && step.id !== expectedIds[index])) {
      throw new Error(`${index + 1}工程目の形式が正しくありません。工程の順序とIDは変更できません。`);
    }
    if (typeof step.title !== 'string' || typeof step.script !== 'string') {
      throw new Error(`${index + 1}工程目のタイトルと台本を文字で入力してください。`);
    }
    const title = step.title.trim();
    const script = step.script.trim();
    if (title.length < 1 || title.length > 80) {
      throw new Error(`${index + 1}工程目のタイトルは1〜80文字で入力してください。`);
    }
    if (script.length < 1 || script.length > 4000) {
      throw new Error(`${index + 1}工程目の台本は1〜4000文字で入力してください。`);
    }
    return { id: step.id, title, script };
  });
  if (new Set(steps.map((step) => step.id)).size !== 3) {
    throw new Error('台本の工程IDが重複しています。');
  }
  return steps;
}

/** Store only editable text; presentation state and external services are separate. */
export function createScriptStore(defaultSteps, { getStorage = () => globalThis.localStorage } = {}) {
  const defaults = normalizeSteps(defaultSteps);
  const expectedIds = defaults.map((step) => step.id);
  const sample = (message) => ({ steps: copySteps(defaults), source: 'sample', message });

  return {
    load() {
      let raw;
      try {
        raw = getStorage().getItem(STORAGE_KEY);
      } catch {
        return sample('このブラウザの保存領域を読み取れないため、サンプル台本を表示しています。保存済みデータは変更していません。');
      }
      if (raw === null) {
        return sample('サンプル台本を表示しています。編集してこのブラウザに保存できます。');
      }
      try {
        // Bound JSON parsing even if another script has written an oversized value.
        if (typeof raw !== 'string' || raw.length > MAX_STORED_LENGTH) throw new Error('Invalid size');
        const saved = JSON.parse(raw);
        if (!hasExactKeys(saved, ['version', 'steps']) || saved.version !== 1) throw new Error('Invalid version');
        return {
          steps: normalizeSteps(saved.steps, expectedIds),
          source: 'saved',
          message: 'このブラウザに保存した台本を読み込みました。',
        };
      } catch {
        return sample('保存済みの台本の形式を確認できないため、サンプル台本を表示しています。保存済みデータは変更していません。');
      }
    },

    save(input) {
      // Reject invalid input before touching storage, preserving a previous save.
      const steps = normalizeSteps(input, expectedIds);
      try {
        getStorage().setItem(STORAGE_KEY, JSON.stringify({ version: 1, steps }));
      } catch (error) {
        const reason = error?.name === 'QuotaExceededError'
          ? 'このブラウザの保存容量が不足しているため、台本を保存できませんでした。'
          : 'このブラウザの保存領域を利用できないため、台本を保存できませんでした。';
        return {
          steps,
          source: 'memory',
          persisted: false,
          message: `${reason}編集内容は今の画面に反映されますが、再読み込みすると失われます。`,
        };
      }
      return { steps, source: 'saved', persisted: true, message: '台本をこのブラウザに保存しました。' };
    },
  };
}
