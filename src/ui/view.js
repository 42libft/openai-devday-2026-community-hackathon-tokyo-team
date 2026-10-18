import { STEPS, DEMO_ITEMS } from '../state/presentation.js';

const PHASE_COPY = {
  idle: { label: '開始前', context: '台本を確認してから、はじめましょう。', stage: '台本プレビュー' },
  presenting: { label: '発表中', context: 'いま話すことを、ひとつずつ。', stage: 'いまの台本' },
  stopped: { label: '停止中', context: '進行を停止しました。最後の状態を表示しています。', stage: '停止した台本' },
};

function textElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = text;
  return element;
}

/** Stable, manual-only presentation UI. State changes belong to the controller. */
export function mountPresentation(root, onIntent, { getSteps = () => STEPS, hasCustomScript = () => false } = {}) {
  root.innerHTML = `
    <div class="workspace-topline">
      <p id="workspace-context"></p>
      <span id="phase-label" class="phase-pill"></span>
    </div>
    <nav class="step-navigation" aria-label="発表の3ステップ"></nav>
    <div class="workspace-grid">
      <section class="presentation-column" aria-label="台本と進行">
        <section class="slide-stage" aria-labelledby="slide-title">
          <div class="slide-meta"><span id="stage-label"></span><span id="step-count"></span></div>
          <div class="slide-content">
            <span id="slide-number" class="slide-number" aria-hidden="true"></span>
            <h2 id="slide-title"></h2>
            <p id="slide-script"></p>
          </div>
          <div class="slide-footer"><span id="script-source">サンプル台本</span><span id="stage-footer-note"></span></div>
          <div class="slide-progress" aria-hidden="true"><span></span></div>
        </section>
        <div id="script-editor-slot" aria-label="台本の編集"></div>
        <div class="start-panel" id="start-panel">
          <p>全3ステップ。ボタンで進行し、直前の操作を取り消せます。</p>
          <button type="button" class="button-primary start-button" data-event="START">台本を確認して開始 <span aria-hidden="true">→</span></button>
        </div>
        <section class="jump-panel" id="jump-panel" aria-labelledby="jump-title" hidden>
          <div><p class="panel-eyebrow">寄り道の確認</p><h3 id="jump-title"></h3><p>今の台本・検索・選択を保存して移動します。</p></div>
          <div class="panel-actions"><button type="button" class="button-primary" data-event="CONFIRM_JUMP">移動する</button><button type="button" class="button-secondary" data-event="CANCEL_JUMP">キャンセル</button></div>
        </section>
        <section class="resume-panel" id="resume-panel" aria-label="寄り道から戻る" hidden>
          <div><span class="panel-eyebrow">寄り道中</span><p id="resume-description"></p></div>
          <button type="button" class="button-resume" data-event="RESUME">続きへ戻る <span aria-hidden="true">↩</span></button>
        </section>
        <div class="stopped-panel" id="stopped-panel" hidden>
          <p>終了した発表はこの位置から再開しません。「はじめから」で再準備できます。</p>
          <button type="button" class="button-primary" data-event="RESTART">はじめから <span aria-hidden="true">↻</span></button>
        </div>
        <section class="control-panel" aria-label="発表の操作">
          <div class="progress-controls">
            <button type="button" class="button-secondary" data-event="PREVIOUS"><span aria-hidden="true">←</span> 前へ</button>
            <button type="button" class="button-primary next-button" data-event="NEXT">次へ <span aria-hidden="true">→</span></button>
            <button type="button" class="button-quiet undo-button" data-event="UNDO"><span aria-hidden="true">↶</span> 取り消し</button>
          </div>
          <div class="status-row"><p id="demo-status" role="status" aria-live="polite" aria-atomic="true"></p><button type="button" class="button-stop" data-event="STOP" aria-describedby="presentation-stop-hint"><span class="stop-symbol" aria-hidden="true"></span> 発表を終了</button></div>
          <p class="field-hint" id="presentation-stop-hint">発表を終了するとカメラ・音声も停止します。再開には「はじめから」で再準備が必要です。</p>
        </section>
        <section class="command-panel" aria-labelledby="command-heading">
          <div class="section-heading"><h3 id="command-heading">言葉で操作</h3><span>決まった言葉だけに対応</span></div>
          <form id="command-form" class="inline-form">
            <label for="command-text" class="sr-only">操作する言葉</label>
            <input id="command-text" type="text" placeholder="例：次へ" autocomplete="off" aria-describedby="command-hint" maxlength="180">
            <button type="submit" class="button-secondary" id="command-submit">操作する</button>
          </form>
          <p id="command-hint" class="field-hint">次へ / 取り消し / 続きへ / 1枚目へ</p>
        </section>
      </section>
      <aside class="demo-column" aria-labelledby="search-heading">
        <section class="search-panel">
          <div class="section-heading"><div><p class="panel-eyebrow">LOCAL DEMO</p><h2 id="search-heading">資料を探す</h2></div><span class="local-badge">架空の資料</span></div>
          <p class="section-description">検索して、発表で見せる資料を選択。</p>
          <form id="search-form" class="search-form">
            <label for="search-query">キーワード</label>
            <div class="inline-form"><input id="search-query" type="search" placeholder="資料名・内容で検索" autocomplete="off" maxlength="120"><button type="submit" class="button-primary" id="search-submit">検索</button></div>
          </form>
          <div class="result-heading"><p id="search-summary"></p><span id="result-count"></span></div>
          <div id="search-results" class="search-results" aria-label="検索結果"></div>
          <p id="empty-results" class="empty-results" hidden>一致する資料はありません。<br>別のキーワードで探してください。</p>
          <p id="search-availability" class="field-hint"></p>
        </section>
        <section class="selected-panel" aria-labelledby="selected-heading">
          <p class="panel-eyebrow" id="selected-heading">選択中の資料</p>
          <h3 id="selected-title"></h3>
          <p id="selected-summary"></p>
        </section>
        <p class="demo-footnote">この画面内の架空データを検索します。寄り道から戻ると、検索と選択も元に戻ります。</p>
      </aside>
    </div>`;

  const get = (selector) => root.querySelector(selector);
  const elements = {
    context: get('#workspace-context'), phase: get('#phase-label'), stageLabel: get('#stage-label'),
    count: get('#step-count'), number: get('#slide-number'), title: get('#slide-title'), script: get('#slide-script'),
    stageNote: get('#stage-footer-note'), progress: get('.slide-progress span'), start: get('#start-panel'),
    jump: get('#jump-panel'), jumpTitle: get('#jump-title'), resume: get('#resume-panel'),
    resumeDescription: get('#resume-description'), stopped: get('#stopped-panel'), status: get('#demo-status'),
    searchForm: get('#search-form'), search: get('#search-query'), searchSubmit: get('#search-submit'),
    searchSummary: get('#search-summary'), resultCount: get('#result-count'), empty: get('#empty-results'),
    availability: get('#search-availability'), selected: get('.selected-panel'),
    selectedTitle: get('#selected-title'), selectedSummary: get('#selected-summary'),
    commandForm: get('#command-form'), command: get('#command-text'), commandSubmit: get('#command-submit'), commandHint: get('#command-hint'),
    scriptSource: get('#script-source'), scriptEditor: get('#script-editor-slot'),
  };
  const stepButtons = getSteps().map((step, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'step-button';
    button.dataset.event = 'REQUEST_JUMP';
    button.dataset.stepTarget = String(index);
    button.setAttribute('aria-label', `${index + 1}枚目「${step.title}」へ寄り道`);
    button.append(textElement('span', 'step-index', String(index + 1).padStart(2, '0')));
    button.append(textElement('span', 'step-name', step.title));
    button.append(textElement('span', 'step-marker', ''));
    get('.step-navigation').append(button);
    return button;
  });
  const resultButtons = DEMO_ITEMS.map((item) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'result-button';
    button.dataset.resultId = item.id;
    button.setAttribute('aria-pressed', 'false');
    const heading = document.createElement('span');
    heading.className = 'result-title-row';
    heading.append(textElement('span', 'result-title', item.title));
    heading.append(textElement('span', 'result-mark', '+'));
    button.append(heading, textElement('span', 'result-summary', item.summary));
    get('#search-results').append(button);
    return button;
  });
  const actionButtons = [...root.querySelectorAll('button[data-event]')];
  let lastQuery;
  let lastSessionEpoch;
  let hadResume = false;
  let hadUndo = false;
  let destroyed = false;
  const onClick = (event) => {
    const button = event.target.closest?.('button');
    if (!button || !root.contains(button) || button.disabled) return;
    if (button.hasAttribute('data-result-id')) {
      onIntent('SELECT', { selectedId: button.dataset.resultId });
    } else if (button.dataset.event === 'REQUEST_JUMP') {
      onIntent('REQUEST_JUMP', { targetStep: Number(button.dataset.stepTarget) });
    } else if (button.dataset.event) {
      onIntent(button.dataset.event, {});
    }
  };
  const onSearch = (event) => {
    event.preventDefault();
    if (!elements.searchSubmit.disabled) onIntent('SEARCH', { query: elements.search.value });
  };
  const onCommand = (event) => {
    event.preventDefault();
    if (!elements.commandSubmit.disabled) onIntent('COMMAND', { text: elements.command.value });
  };
  root.addEventListener('click', onClick);
  elements.searchForm.addEventListener('submit', onSearch);
  elements.commandForm.addEventListener('submit', onCommand);

  return {
    render(state) {
      if (destroyed) return;
      const steps = getSteps();
      const phase = PHASE_COPY[state.phase] ?? PHASE_COPY.idle;
      const stepIndex = Math.max(0, Math.min(steps.length - 1, state.step));
      const step = steps[stepIndex];
      const presenting = state.phase === 'presenting';
      const pending = Boolean(state.pendingJump);
      const canOperate = presenting && !pending;
      const resume = state.resumeSnapshot;
      root.dataset.phase = state.phase;
      root.dataset.revision = String(state.revision);
      root.dataset.step = String(stepIndex);
      elements.context.textContent = phase.context;
      elements.phase.textContent = phase.label;
      elements.stageLabel.textContent = phase.stage;
      elements.count.textContent = `${stepIndex + 1} / ${steps.length}`;
      elements.number.textContent = String(stepIndex + 1).padStart(2, '0');
      elements.title.textContent = step.title;
      elements.script.textContent = step.script;
      elements.scriptSource.textContent = hasCustomScript() ? '自分の台本' : 'サンプル台本';
      elements.scriptEditor.hidden = state.phase !== 'idle';
      elements.stageNote.textContent = state.phase === 'stopped' ? '進行は停止しています' : resume ? '寄り道中・続きへ戻れます' : '自分のペースで進める';
      elements.progress.style.width = `${((stepIndex + 1) / steps.length) * 100}%`;
      elements.start.hidden = state.phase !== 'idle';
      elements.jump.hidden = !pending || !presenting;
      elements.resume.hidden = !resume || !presenting;
      elements.stopped.hidden = state.phase !== 'stopped';
      if (pending) {
        const target = steps[state.pendingJump.targetStep];
        elements.jumpTitle.textContent = `${state.pendingJump.targetStep + 1}枚目「${target?.title ?? ''}」へ移動しますか？`;
      }
      if (resume) {
        const returnStep = steps[resume.step];
        elements.resumeDescription.textContent = `${resume.step + 1}枚目「${returnStep?.title ?? ''}」の続きへ戻れます。`;
      }
      const allowed = {
        START: state.phase === 'idle',
        NEXT: canOperate && stepIndex < steps.length - 1,
        PREVIOUS: canOperate && stepIndex > 0,
        UNDO: canOperate && Boolean(state.undoSnapshot),
        STOP: presenting,
        RESTART: state.phase === 'stopped',
        REQUEST_JUMP: canOperate && !resume,
        CONFIRM_JUMP: presenting && pending,
        CANCEL_JUMP: presenting && pending,
        RESUME: canOperate && Boolean(resume),
      };
      for (const button of actionButtons) button.disabled = !allowed[button.dataset.event];
      stepButtons.forEach((button, index) => {
        button.querySelector('.step-name').textContent = steps[index].title;
        button.setAttribute('aria-label', `${index + 1}枚目「${steps[index].title}」へ寄り道`);
        const current = index === stepIndex;
        button.disabled = !allowed.REQUEST_JUMP || current;
        button.classList.toggle('is-current', current);
        button.classList.toggle('is-complete', index < stepIndex);
        if (current) button.setAttribute('aria-current', 'step');
        else button.removeAttribute('aria-current');
        button.querySelector('.step-marker').textContent = current ? '現在' : '↗';
      });
      elements.search.disabled = !canOperate;
      elements.searchSubmit.disabled = !canOperate;
      elements.command.disabled = false;
      elements.commandSubmit.disabled = false;
      elements.command.placeholder = state.phase === 'idle' ? '例：準備する' : state.phase === 'stopped' ? '例：はじめから' : '例：次へ';
      elements.commandHint.textContent = state.phase === 'idle' ? '「準備する」で発表を開始できます。'
        : state.phase === 'stopped' ? '「はじめから」で再準備します。停止中は進行しません。'
          : '次へ / 取り消し / 続きへ / 1枚目へ';
      const restored = state.sessionEpoch !== lastSessionEpoch || (hadResume && !resume) || (hadUndo && !state.undoSnapshot);
      if (state.query !== lastQuery || restored) {
        elements.search.value = state.query ?? '';
        lastQuery = state.query;
      }
      lastSessionEpoch = state.sessionEpoch;
      hadResume = Boolean(resume);
      hadUndo = Boolean(state.undoSnapshot);
      const resultIds = new Set(state.resultIds ?? []);
      elements.searchSummary.textContent = state.query ? `「${state.query}」の検索結果` : 'すべての資料';
      elements.resultCount.textContent = `${resultIds.size}件`;
      elements.empty.hidden = resultIds.size !== 0;
      resultButtons.forEach((button) => {
        const selected = button.dataset.resultId === state.selectedId;
        button.hidden = !resultIds.has(button.dataset.resultId);
        button.disabled = !canOperate;
        button.classList.toggle('is-selected', selected);
        button.setAttribute('aria-pressed', String(selected));
        button.querySelector('.result-mark').textContent = selected ? '✓' : '+';
      });
      const selected = DEMO_ITEMS.find((item) => item.id === state.selectedId);
      elements.selected.classList.toggle('has-selection', Boolean(selected));
      elements.selectedTitle.textContent = selected?.title ?? 'まだ選択していません';
      elements.selectedSummary.textContent = selected?.summary ?? '検索結果から資料をひとつ選べます。';
      elements.availability.textContent = state.phase === 'idle'
        ? '発表を開始すると、検索・選択を試せます。'
        : state.phase === 'stopped' ? '停止時の検索・選択を表示しています。'
          : pending ? '移動するかキャンセルすると操作できます。' : '空欄で検索すると、すべての資料を表示します。';
      elements.status.textContent = state.message || phase.context;
    },
    announce(message) { if (!destroyed) elements.status.textContent = message; },
    destroy() {
      destroyed = true;
      root.removeEventListener('click', onClick);
      elements.searchForm.removeEventListener('submit', onSearch);
      elements.commandForm.removeEventListener('submit', onCommand);
    },
  };
}
