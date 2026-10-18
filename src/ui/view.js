import { STEPS } from '../state/presentation.js';

const PHASE_COPY = {
  idle: { label: '開始前', context: '資料を読み込み、内容を確認して発表を始めましょう。', stage: '内容の確認' },
  presenting: { label: '発表中', context: 'いま話すことを、ひとつずつ。', stage: '発表中のページ' },
  stopped: { label: '停止中', context: '進行を停止しました。最後の状態を表示しています。', stage: '終了したページ' },
};

function textElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = text;
  return element;
}

/** Stable, manual-only presentation UI. State changes belong to the controller. */
export function mountPresentation(root, onIntent, { getSteps = () => STEPS, hasCustomScript = () => false, getDeck = () => null, onRenderSlide = () => {} } = {}) {
  root.innerHTML = `
    <div class="workspace-topline">
      <p id="workspace-context"></p>
      <span id="phase-label" class="phase-pill"></span>
    </div>
    <div class="workspace-grid">
      <section class="presentation-column" aria-label="スライドと進行">
        <div id="deck-upload-slot" aria-label="スライドの読み込み"></div>
        <nav class="step-navigation" aria-label="発表のページ"></nav>
        <section class="slide-stage" aria-labelledby="slide-title">
          <div class="slide-meta"><span id="stage-label"></span><span id="step-count"></span></div>
          <div class="slide-content" id="script-slide-content">
            <span id="slide-number" class="slide-number" aria-hidden="true"></span>
            <h2 id="slide-title"></h2>
            <p id="slide-script"></p>
          </div>
          <div id="uploaded-slide" class="uploaded-slide" hidden></div>
          <button type="button" class="button-secondary slide-render-retry" data-event="RENDER_RETRY" hidden>表示を再試行</button>
          <div class="slide-footer"><span id="script-source">サンプル台本</span><span id="stage-footer-note"></span></div>
          <div class="slide-progress" aria-hidden="true"><span></span></div>
        </section>
        <div class="start-panel" id="start-panel">
          <p id="start-description"></p>
          <button type="button" class="button-primary start-button" data-event="START">内容を確認して発表開始 <span aria-hidden="true">→</span></button>
        </div>
        <div id="script-editor-slot" aria-label="任意の台本編集"></div>
        <section class="presentation-dock" aria-label="発表の操作と戻り先">
        <section class="jump-panel" id="jump-panel" aria-labelledby="jump-title" hidden>
          <div><p class="panel-eyebrow">寄り道の確認</p><h3 id="jump-title"></h3><p>今のページを戻り先として記憶します。</p></div>
          <div class="panel-actions"><button type="button" class="button-primary" data-event="CONFIRM_JUMP">移動する</button><button type="button" class="button-secondary" data-event="CANCEL_JUMP">キャンセル</button></div>
        </section>
        <section class="resume-panel" id="resume-panel" aria-label="寄り道から戻る" hidden>
          <div><span class="panel-eyebrow">寄り道中</span><p id="resume-description"></p></div>
          <button type="button" class="button-resume" data-event="RESUME">続きへ戻る <span aria-hidden="true">↩</span></button>
        </section>
        <section class="control-panel" aria-label="発表の操作">
          <div class="projection-entry">
            <button type="button" class="button-secondary" data-event="OPEN_PROJECTION">スライドのみ表示</button>
            <button type="button" class="button-secondary" data-event="FULLSCREEN_PROJECTION">スライドを全画面表示</button>
          </div>
          <div class="progress-controls">
            <button type="button" class="button-secondary" data-event="PREVIOUS"><span aria-hidden="true">←</span> 前へ</button>
            <button type="button" class="button-primary next-button" data-event="NEXT">次へ <span aria-hidden="true">→</span></button>
            <button type="button" class="button-quiet undo-button" data-event="UNDO"><span aria-hidden="true">↶</span> 取り消し</button>
          </div>
          <div class="status-row"><p id="demo-status" role="status" aria-live="polite" aria-atomic="true"></p><button type="button" class="button-stop" data-event="STOP" aria-describedby="presentation-stop-hint"><span class="stop-symbol" aria-hidden="true"></span> 発表を終了</button></div>
          <p class="sr-only" id="presentation-stop-hint">発表を終了するとカメラ・音声も停止します。再開には「はじめから」で再準備が必要です。</p>
        </section>
        </section>
        <div class="stopped-panel" id="stopped-panel" hidden>
          <p>終了した発表はこの位置から再開しません。「はじめから」で再準備できます。</p>
          <button type="button" class="button-primary" data-event="RESTART">はじめから <span aria-hidden="true">↻</span></button>
        </div>
      </section>
    </div>`;

  const get = (selector) => root.querySelector(selector);
  const elements = {
    context: get('#workspace-context'), phase: get('#phase-label'), stageLabel: get('#stage-label'),
    count: get('#step-count'), number: get('#slide-number'), title: get('#slide-title'), script: get('#slide-script'),
    stageNote: get('#stage-footer-note'), progress: get('.slide-progress span'), start: get('#start-panel'),
    jump: get('#jump-panel'), jumpTitle: get('#jump-title'), resume: get('#resume-panel'),
    resumeDescription: get('#resume-description'), stopped: get('#stopped-panel'), status: get('#demo-status'),
    dock: get('.presentation-dock'),
    scriptSource: get('#script-source'), scriptEditor: get('#script-editor-slot'),
    scriptContent: get('#script-slide-content'), uploaded: get('#uploaded-slide'), retry: get('.slide-render-retry'), startDescription: get('#start-description'),
  };
  let stepButtons = [], navigationSignature = '';
  function syncNavigation(steps) {
    const signature = JSON.stringify(steps.map(step => [step.id, step.title]));
    if (signature === navigationSignature) return;
    navigationSignature = signature;
    get('.step-navigation').replaceChildren();
    stepButtons = steps.map((step, index) => {
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
  }
  syncNavigation(getSteps());
  let destroyed = false;
  let renderError = false, previousDeck = null, previousPage = -1;
  const onClick = (event) => {
    const button = event.target.closest?.('button');
    if (!button || !root.contains(button) || button.disabled) return;
    if (button.dataset.event === 'REQUEST_JUMP') {
      onIntent('REQUEST_JUMP', { targetStep: Number(button.dataset.stepTarget) });
    } else if (button.dataset.event) {
      onIntent(button.dataset.event, {});
    }
  };
  root.addEventListener('click', onClick);
  const page = root.ownerDocument.documentElement;
  function syncDockSpace() {
    const height = root.dataset.phase === 'presenting'
      ? Math.ceil(elements.dock.getBoundingClientRect().height) : 0;
    root.style.setProperty('--presentation-dock-height', `${height}px`);
    page?.style.setProperty('--presentation-dock-height', `${height}px`);
  }
  const ResizeObserverClass = root.ownerDocument.defaultView?.ResizeObserver;
  const dockObserver = ResizeObserverClass ? new ResizeObserverClass(syncDockSpace) : null;
  dockObserver?.observe(elements.dock);
  root.ownerDocument.defaultView?.addEventListener('resize', syncDockSpace);

  return {
    render(state) {
      if (destroyed) return;
      const steps = getSteps();
      syncNavigation(steps);
      const deck = getDeck();
      if (deck !== previousDeck || state.step !== previousPage) renderError = false;
      previousDeck = deck; previousPage = state.step;
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
      elements.scriptSource.textContent = deck ? deck.name : hasCustomScript() ? '自分の台本' : 'サンプル台本';
      elements.scriptEditor.hidden = state.phase !== 'idle' || Boolean(deck);
      elements.scriptContent.hidden = Boolean(deck);
      elements.uploaded.hidden = !deck;
      elements.retry.hidden = !deck || !renderError;
      get('.slide-stage').classList.toggle('has-uploaded-deck', Boolean(deck));
      elements.startDescription.textContent = deck
        ? `読み込んだ${steps.length}ページを確認したら、発表を開始してください。`
        : hasCustomScript()
          ? '編集した台本を確認して開始できます。資料ファイルを読み込むこともできます。'
          : '資料ファイルを読み込むと、ここで内容を確認できます。サンプルで操作を試すこともできます。';
      const pageBadge = root.ownerDocument.querySelector('.build-label span');
      if (pageBadge) pageBadge.textContent = `${steps.length} PAGES`;
      onRenderSlide(deck, stepIndex, elements.uploaded);
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
        RENDER_RETRY: Boolean(deck),
        OPEN_PROJECTION: presenting,
        FULLSCREEN_PROJECTION: presenting,
      };
      for (const button of root.querySelectorAll('button[data-event]')) button.disabled = !allowed[button.dataset.event];
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
      elements.status.textContent = state.phase === 'idle' ? '内容を確認したら、発表を開始できます。' : state.message || phase.context;
      syncDockSpace();
    },
    announce(message) { if (!destroyed) { elements.status.textContent = message; syncDockSpace(); } },
    setSlideError(value) { renderError = value; elements.retry.hidden = !getDeck() || !renderError; },
    destroy() {
      destroyed = true;
      root.removeEventListener('click', onClick);
      dockObserver?.disconnect();
      root.ownerDocument.defaultView?.removeEventListener('resize', syncDockSpace);
      root.style.removeProperty('--presentation-dock-height');
      page?.style.removeProperty('--presentation-dock-height');
    },
  };
}
