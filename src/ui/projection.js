import { createProjectionController } from '../projection/controller.js';

/** Move only slide pixels into a separate projection surface; never copy notes/UI. */
export function mountProjection({ appShell, slideContainer, getState, onIntent, onManual, onMessage }) {
  const document = appShell.ownerDocument;
  const window = document.defaultView;
  const marker = document.createComment('uploaded-slide-home');
  slideContainer.before(marker);
  const shell = document.createElement('section');
  shell.id = 'projection-shell'; shell.className = 'projection-shell'; shell.hidden = true;
  shell.tabIndex = -1; shell.setAttribute('role', 'dialog'); shell.setAttribute('aria-modal', 'true');
  shell.setAttribute('aria-label', 'スライドの投影表示');
  shell.innerHTML = `
    <div class="projection-surface">
      <section class="projection-sample" hidden><h1 id="projection-title"></h1></section>
    </div>
    <p class="sr-only">Escで操作画面へ戻ります。左右矢印で移動、Rで寄り道から復帰、Tabで操作ボタンへ移動できます。</p>
    <div class="projection-confirm" hidden>
      <p id="projection-confirm-label"></p>
      <button type="button" data-project-intent="CONFIRM_JUMP">移動する</button>
      <button type="button" data-project-intent="CANCEL_JUMP">キャンセル</button>
    </div>
    <nav class="projection-controls" aria-label="投影中の操作">
      <button type="button" id="projection-exit">操作画面へ戻る</button>
      <button type="button" data-project-intent="PREVIOUS">前へ</button>
      <button type="button" data-project-intent="NEXT">次へ</button>
      <button type="button" data-project-intent="RESUME">続きへ戻る</button>
      <button type="button" id="projection-manual">手動に切り替え</button>
      <button type="button" data-project-intent="STOP">発表を終了</button>
      <p id="projection-feedback" role="status" aria-live="polite"></p>
    </nav>`;
  document.body.append(shell);
  const surface = shell.querySelector('.projection-surface');
  const sample = shell.querySelector('.projection-sample');
  const feedback = shell.querySelector('#projection-feedback');
  let focused, scroll, previousInert, previousOverflow;
  function message(text) { feedback.textContent = text; onMessage(text); }
  const mode = createProjectionController({
    getPhase: () => getState().phase,
    canFullscreen: () => typeof shell.requestFullscreen === 'function' && document.fullscreenEnabled !== false,
    isFullscreen: () => document.fullscreenElement === shell,
    requestFullscreen: () => shell.requestFullscreen(),
    exitFullscreen: () => document.exitFullscreen(),
    onEnter() {
      focused = document.activeElement; scroll = [window.scrollX, window.scrollY];
      previousInert = appShell.inert; previousOverflow = document.body.style.overflow;
      surface.append(slideContainer); shell.hidden = false; appShell.inert = true;
      document.body.style.overflow = 'hidden'; feedback.textContent = '';
      shell.focus({preventScroll: true});
    },
    onExit() {
      marker.after(slideContainer); shell.hidden = true;
      appShell.inert = previousInert; document.body.style.overflow = previousOverflow;
      if (focused?.isConnected && !focused.disabled) focused.focus({preventScroll:true});
      window.scrollTo(...scroll);
    },
    onMessage: message,
  });
  const close = () => { void mode.close(); };
  const fullscreenChanged = () => mode.fullscreenChanged();
  const key = event => {
    if (mode.active && event.key === 'Escape') {
      // Do not turn a browser fullscreen exit into a CANCEL_JUMP command.
      event.stopImmediatePropagation(); close();
    }
  };
  shell.querySelector('#projection-exit').addEventListener('click', close);
  shell.querySelector('#projection-manual').addEventListener('click', () => {
    onManual(); message('音声とカメラを停止しました。左右矢印またはボタンで続けられます。');
  });
  shell.addEventListener('click', event => {
    const button = event.target.closest?.('[data-project-intent]');
    if (button && !button.disabled) onIntent(button.dataset.projectIntent);
  });
  document.addEventListener('fullscreenchange', fullscreenChanged);
  document.addEventListener('keydown', key, true);
  return {
    open: options => mode.open(options),
    render(state, { deck, title }) {
      mode.phaseChanged();
      sample.hidden = Boolean(deck);
      shell.querySelector('#projection-title').textContent = title ?? '';
      const pending = Boolean(state.pendingJump);
      shell.querySelector('.projection-confirm').hidden = !pending;
      shell.querySelector('#projection-confirm-label').textContent = pending ? `${state.pendingJump.targetStep + 1}枚目へ移動しますか？` : '';
      const allowed = {
        NEXT: state.phase === 'presenting' && !pending && state.step < state.stepCount - 1,
        PREVIOUS: state.phase === 'presenting' && !pending && state.step > 0,
        RESUME: state.phase === 'presenting' && !pending && Boolean(state.resumeSnapshot),
        STOP: state.phase === 'presenting',
        CONFIRM_JUMP: state.phase === 'presenting' && pending,
        CANCEL_JUMP: state.phase === 'presenting' && pending,
      };
      for (const button of shell.querySelectorAll('[data-project-intent]')) button.disabled = !allowed[button.dataset.projectIntent];
    },
    get active() { return mode.active; },
  };
}
