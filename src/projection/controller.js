/** Display lifecycle only. Presentation state and sensor ownership stay elsewhere. */
export function createProjectionController({ getPhase, canFullscreen, isFullscreen, requestFullscreen,
  exitFullscreen, onEnter, onExit, onMessage }) {
  let active = false, pending = false, native = false, generation = 0;
  function leave() {
    if (!active) return;
    active = false; native = false; generation++;
    onExit();
  }
  async function close() {
    if (!active) return;
    generation++;
    if (isFullscreen()) {
      try { await exitFullscreen(); }
      catch {
        if (isFullscreen()) {
          onMessage('全画面を終了できませんでした。Escまたはブラウザの全画面終了操作をお使いください。');
          return;
        }
      }
    }
    leave();
  }
  return {
    async open({ fullscreen = false } = {}) {
      if (active || pending) return;
      if (getPhase() !== 'presenting') { onMessage('発表を開始してから投影表示へ切り替えてください。'); return; }
      if (fullscreen && !canFullscreen()) {
        onMessage('このブラウザでは全画面表示を利用できません。「スライドのみ表示」か通常画面で続けられます。');
        return;
      }
      const id = ++generation;
      active = true; onEnter();
      if (!fullscreen) return;
      pending = true;
      try {
        // Called directly from the user's click, before yielding activation.
        await requestFullscreen();
        if (id !== generation || !active || getPhase() !== 'presenting') {
          if (isFullscreen()) await exitFullscreen();
          return;
        }
        if (!isFullscreen()) throw new Error('Fullscreen was not entered');
        native = true;
      } catch {
        if (id === generation && active) {
          leave();
          onMessage('全画面表示を開始できませんでした。「スライドのみ表示」か通常画面で続けられます。');
        }
      } finally { pending = false; }
    },
    close,
    fullscreenChanged() {
      if (!active) return;
      if (isFullscreen()) native = true;
      else if (native) leave();
    },
    phaseChanged() { if (active && getPhase() !== 'presenting') void close(); },
    get active() { return active; },
    get pending() { return pending; },
  };
}
