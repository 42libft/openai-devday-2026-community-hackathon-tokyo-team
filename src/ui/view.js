const textElement = (tag, text) => {
  const element = document.createElement(tag);
  element.textContent = text;
  return element;
};

/** Stable controls; imported filenames/notes are always rendered as text. */
export function mountPresentation(root, onIntent, {getDeck = () => null, onRenderSlide = () => {}} = {}) {
  root.innerHTML = `
    <div class="workspace-topline"><p id="workspace-context">スライドを読み込み、内容を確認して発表へ。</p><span id="phase-label" class="phase-pill"></span></div>
    <div id="deck-upload-slot"></div>
    <div class="workspace-grid">
      <section class="presentation-column" aria-label="スライドと進行">
        <section class="slide-stage" aria-labelledby="slide-title">
          <div class="slide-meta"><span id="stage-label"></span><span id="step-count"></span></div>
          <h2 id="slide-title"></h2>
          <div id="uploaded-slide" class="uploaded-slide" hidden></div><button type="button" class="button-secondary" data-event="RENDER_RETRY" hidden>表示を再試行</button>
          <p id="empty-deck">手持ちのPDF / PowerPoint（PPTX）を上の欄から読み込んでください。</p>
          <div class="slide-progress" aria-hidden="true"><span></span></div>
        </section>
        <div class="start-panel" id="start-panel"><p>一覧で各ページを確認できます。発表は1枚目から始まります。</p><button type="button" class="button-primary start-button" data-event="START">この資料で発表を開始 →</button></div>
        <section class="jump-panel" id="jump-panel" aria-labelledby="jump-title" hidden>
          <div><p class="panel-eyebrow">寄り道の確認</p><h3 id="jump-title"></h3><p>現在のスライドを戻り先として保持します。</p></div>
          <div class="panel-actions"><button type="button" class="button-primary" data-event="CONFIRM_JUMP">移動する</button><button type="button" class="button-secondary" data-event="CANCEL_JUMP">キャンセル</button></div>
        </section>
        <section class="resume-panel" id="resume-panel" aria-label="寄り道から戻る" hidden><p id="resume-description"></p><button type="button" class="button-resume" data-event="RESUME">続きへ戻る ↩</button></section>
        <div class="stopped-panel" id="stopped-panel" hidden><p>資料とノートを保持しています。再準備すると1枚目に戻ります。</p><button type="button" class="button-primary" data-event="RESTART">はじめから ↻</button></div>
        <section class="control-panel" aria-label="発表の操作">
          <div class="progress-controls">
            <button type="button" class="button-secondary" data-event="PREVIOUS">← 前へ</button>
            <button type="button" class="button-primary next-button" data-event="NEXT">次へ →</button>
            <button type="button" class="button-quiet undo-button" data-event="UNDO">↶ 取り消し</button>
          </div>
          <div class="status-row"><p id="demo-status" role="status" aria-live="polite" aria-atomic="true"></p><button type="button" class="button-stop" data-event="STOP">発表を終了</button></div>
          <p class="field-hint">← / →・PageUp / PageDownで前後、Uで取消し、Rで復帰、Qで発表終了。文字入力中は無効です。</p>
        </section>
        <details id="notes-panel" class="notes-panel" hidden><summary>発表者ノート（任意）</summary><label for="slide-notes">このスライドのノート</label><textarea id="slide-notes" rows="4" maxlength="4000"></textarea><p class="field-hint">準備中に編集できます。自動生成はしません。このタブ内だけで保持し、再読み込みで消えます。</p></details>
      </section>
      <aside class="slide-list-panel" aria-label="読み込んだスライド">
        <h2>スライド一覧</h2><p id="list-hint" class="field-hint"></p><nav id="slide-list" aria-label="スライド一覧"></nav>
      </aside>
    </div>`;
  const get = selector => root.querySelector(selector);
  let currentState;
  let lastDeck, lastPage, renderError = false;
  let renderedSlides;
  let buttons = [];
  root.addEventListener('click', event => {
    const button = event.target.closest?.('button');
    if (!button || !root.contains(button) || button.disabled) return;
    if (button.dataset.slide !== undefined) {
      onIntent(currentState.phase === 'idle' ? 'PREVIEW' : 'REQUEST_JUMP', {targetStep: Number(button.dataset.slide)});
    } else if (button.dataset.event) onIntent(button.dataset.event);
  });
  get('#slide-notes').addEventListener('input', () => onIntent('EDIT_NOTE', {notes: get('#slide-notes').value}));
  return {
    announce(message) { get('#demo-status').textContent = message; },
    setSlideError(value) { renderError = value; get('[data-event=RENDER_RETRY]').hidden = !value; },
    render(state) {
      currentState = state;
      const slides = state.slides;
      const slide = slides[state.step];
      const presenting = state.phase === 'presenting';
      const pending = state.pendingJump;
      if (lastDeck !== getDeck() || lastPage !== state.step) renderError = false;
      lastDeck = getDeck(); lastPage = state.step;
      get('[data-event=RENDER_RETRY]').hidden = !renderError;
      const badge = root.ownerDocument.querySelector('.build-label span');
      if (badge) badge.textContent = `${slides.length} PAGES`;
      root.dataset.phase = state.phase;
      root.dataset.revision = String(state.revision);
      root.dataset.step = String(state.step);
      get('#phase-label').textContent = {idle:'内容確認',presenting:'発表中',stopped:'終了'}[state.phase];
      get('#stage-label').textContent = presenting ? '発表中のスライド' : state.phase === 'stopped' ? '終了したスライド' : '内容を確認';
      get('#step-count').textContent = slides.length ? `${state.step + 1} / ${slides.length}` : '0枚';
      get('#slide-title').textContent = slide?.title ?? 'スライドを読み込む';
      get('#uploaded-slide').hidden = !slide;
      onRenderSlide(getDeck(), state.step, get('#uploaded-slide'));
      get('#empty-deck').hidden = Boolean(slide);
      get('.slide-progress span').style.width = slides.length ? `${(state.step + 1) / slides.length * 100}%` : '0%';
      get('#start-panel').hidden = state.phase !== 'idle' || !slide;
      get('#stopped-panel').hidden = state.phase !== 'stopped';
      get('#jump-panel').hidden = !pending;
      get('#jump-title').textContent = pending ? `${pending.targetStep + 1}枚目「${slides[pending.targetStep].title}」へ？` : '';
      get('#resume-panel').hidden = !state.resumeSnapshot;
      get('#resume-description').textContent = state.resumeSnapshot ? `${state.resumeSnapshot.step + 1}枚目へ戻れます。` : '';
      get('#demo-status').textContent = state.message;
      for (const button of root.querySelectorAll('button[data-event]')) {
        const type = button.dataset.event;
        button.disabled = type === 'RENDER_RETRY' ? !slide : type === 'START' ? state.phase !== 'idle' || !slide
          : type === 'RESTART' ? state.phase !== 'stopped'
          : type === 'STOP' ? !presenting
          : ['CONFIRM_JUMP','CANCEL_JUMP'].includes(type) ? !pending
          : type === 'RESUME' ? !presenting || !state.resumeSnapshot || Boolean(pending)
          : type === 'UNDO' ? !presenting || !state.undoSnapshot || Boolean(pending)
          : !presenting || Boolean(pending) || (type === 'NEXT' ? state.step === slides.length - 1 : state.step === 0);
      }
      get('#notes-panel').hidden = !slide;
      const notes = get('#slide-notes');
      if (notes.value !== (slide?.notes ?? '')) notes.value = slide?.notes ?? '';
      notes.readOnly = state.phase !== 'idle';
      get('#list-hint').textContent = state.phase === 'idle' ? 'ページを選んで確認できます。' : 'ページを選び、確認すると寄り道します。戻り先は1か所です。';
      // Notes edits do not rebuild/focus-reset the slide list.
      if (renderedSlides !== slides && (!renderedSlides || renderedSlides.length !== slides.length || renderedSlides.some((old,i) => old.id !== slides[i].id))) {
        buttons = slides.map((entry, index) => {
          const button = document.createElement('button');
          button.type = 'button'; button.className = 'slide-list-button'; button.dataset.slide = String(index);
          button.append(textElement('span', `${index + 1}. ${entry.title}`));
          return button;
        });
        get('#slide-list').replaceChildren(...buttons);
      }
      renderedSlides = slides;
      buttons.forEach((button, index) => {
        button.disabled = state.phase === 'stopped' || Boolean(state.resumeSnapshot) || (state.step === index);
        button.setAttribute('aria-current', state.step === index ? 'page' : 'false');
      });
    },
  };
}
