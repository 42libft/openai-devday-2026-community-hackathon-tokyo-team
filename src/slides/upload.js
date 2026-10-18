export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_SLIDES = 100;

export function validateSlideFile(file) {
  if (!file || typeof file.name !== 'string' || typeof file.arrayBuffer !== 'function') throw new Error('PDFまたはPPTXファイルを選んでください。');
  if (!Number.isFinite(file.size) || file.size <= 0) throw new Error('空のファイルは読み込めません。');
  if (file.size > MAX_FILE_BYTES) throw new Error('ファイルは25MB以下にしてください。');
  const kind = /\.(pdf|pptx)$/iu.exec(file.name)?.[1].toLowerCase();
  if (!kind) throw new Error('対応形式はPDFとPPTXです。PPTやKEYはPDFへ書き出してください。');
  return kind;
}

/** Only the latest explicit selection may replace a prepared deck. */
export function createUploadSession({ load, canApply, onBusy, onApply, onMessage }) {
  let generation = 0;
  let busy = false;
  let controller;
  const setBusy = value => { busy = value; onBusy(value); };
  return {
    async select(file) {
      const id = ++generation;
      controller?.abort();
      controller = new AbortController();
      let deck;
      try {
        const kind = validateSlideFile(file);
        setBusy(true);
        onMessage(`${file.name} を読み込んでいます…`);
        deck = await load(file, kind, controller.signal);
        if (id !== generation || !canApply()) { deck.destroy(); return; }
        if (!Array.isArray(deck.steps) || deck.steps.length < 1 || deck.steps.length > MAX_SLIDES) throw new Error('スライドは1〜100枚で読み込んでください。');
        onApply(deck);
        deck = null; // Ownership passes to the application.
      } catch (error) {
        deck?.destroy();
        if (id === generation) onMessage(error?.message || '読み込めませんでした。PDFへ書き出して再度選んでください。', true);
      } finally {
        if (id === generation) setBusy(false);
      }
    },
    cancel() { generation++; controller?.abort(); setBusy(false); onMessage('読み込みをキャンセルしました。現在のスライドを保持しています。'); },
    get busy() { return busy; },
  };
}

/** Newer navigation wins even if an older render resolves later. */
export function createSlidePresenter(container, onError) {
  let generation = 0, current = null, lastDeck = null, lastIndex = -1;
  return {
    async show(deck, index) {
      if (deck === lastDeck && index === lastIndex) return;
      lastDeck = deck; lastIndex = index;
      const id = ++generation;
      current?.dispose(); current = null;
      container.replaceChildren();
      if (!deck) return;
      const label = container.ownerDocument.createElement('p');
      label.textContent = `${index + 1}枚目を表示しています…`;
      container.append(label);
      try {
        const rendered = await deck.render(index);
        if (id !== generation) { rendered.dispose(); return; }
        current = rendered;
        if (Number.isFinite(rendered.aspectRatio) && rendered.aspectRatio > 0) container.style?.setProperty('--slide-ratio', String(rendered.aspectRatio));
        container.replaceChildren(rendered.element);
      } catch {
        if (id !== generation) return;
        lastIndex = -1;
        label.textContent = 'このページを表示できません。「表示を再試行」または別のページを選んでください。';
        onError(label.textContent);
      }
    },
    destroy() { generation++; current?.dispose(); current = null; lastDeck = null; lastIndex = -1; container.replaceChildren(); },
  };
}
