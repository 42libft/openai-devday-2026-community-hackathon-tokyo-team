const STATUS_LABELS = {
  idle: '開始前',
  starting: 'カメラを準備中',
  capturing: '画像を取得中',
  judging: 'AIが判定中',
  result: 'カメラ操作中',
  error: '確認が必要です',
  stopped: '停止中',
};

const ACTION_LABELS = {
  NEXT: '次へ', next: '次へ',
  PREVIOUS: '前へ', previous: '前へ', prev: '前へ',
  NONE: '操作なし', none: '操作なし',
  NEUTRAL: '操作なし', neutral: '操作なし',
  UNKNOWN: '判定できません', unknown: '判定できません',
  open_palm: '次へ', fist: '前へ',
};

let panelSequence = 0;

/** Display camera state and relay explicit user actions. Owns no media or network. */
export function mountCameraPanel(container, { onStart, onStop, onCapture, onUndo }) {
  const panel = document.createElement('section');
  const headingId = `camera-heading-${++panelSequence}`;
  panel.className = 'camera-panel';
  panel.setAttribute('aria-labelledby', headingId);
  panel.innerHTML = `
    <div class="camera-panel-heading">
      <div class="camera-title-group"><span class="camera-ai-label">AI実判定</span><h2></h2></div>
      <span class="camera-state-badge"></span>
    </div>
    <p class="camera-consent">開始するとカメラの静止画を約2秒おきにOpenAIへ送り判定します。停止で送信終了。</p>
    <div class="camera-panel-content">
      <div class="camera-preview">
        <video muted playsinline autoplay aria-label="カメラのプレビュー"></video>
        <p class="camera-preview-placeholder">開始後に映像を表示</p>
        <span class="camera-preview-caption">カメラ映像</span>
      </div>
      <div class="camera-operation">
        <ol class="camera-gesture-guide" aria-label="ジェスチャーの使い方">
          <li><span class="camera-gesture-icon" aria-hidden="true">✋</span><span>開いた手<span class="camera-gesture-direction">次へ →</span></span></li>
          <li><span class="camera-gesture-icon" aria-hidden="true">✊</span><span>握り拳<span class="camera-gesture-direction">← 前へ</span></span></li>
          <li class="camera-release-step"><span class="camera-gesture-icon" aria-hidden="true">↓</span><span>手を下ろして<span class="camera-gesture-direction">次の合図</span></span></li>
        </ol>
        <div class="camera-actions">
          <button type="button" class="button-primary" data-camera-action="start">同意してカメラを開始</button>
          <button type="button" class="button-secondary camera-stop-button" data-camera-action="stop">カメラを停止</button>
          <button type="button" class="button-secondary" data-camera-action="capture">画像を1回判定</button>
          <div class="camera-manual-control"><span>手動操作</span><button type="button" class="button-quiet" data-camera-action="undo">取り消し</button></div>
        </div>
        <p class="camera-live-status" role="status" aria-live="polite" aria-atomic="true"></p>
        <dl class="camera-result" aria-label="最新のAI判定">
          <div><dt>最新判定</dt><dd data-camera-metric="action">—</dd></div>
          <div><dt>確信度</dt><dd data-camera-metric="confidence">—</dd></div>
          <div><dt>判定時間</dt><dd data-camera-metric="latency">—</dd></div>
        </dl>
      </div>
    </div>`;
  const heading = panel.querySelector('h2');
  heading.id = headingId;
  heading.textContent = 'カメラでスライドを操作';
  const video = panel.querySelector('video');
  video.muted = true;
  video.playsInline = true;
  const badge = panel.querySelector('.camera-state-badge');
  const placeholder = panel.querySelector('.camera-preview-placeholder');
  const statusText = panel.querySelector('.camera-live-status');
  const startButton = panel.querySelector('[data-camera-action="start"]');
  const stopButton = panel.querySelector('[data-camera-action="stop"]');
  const captureButton = panel.querySelector('[data-camera-action="capture"]');
  const actionValue = panel.querySelector('[data-camera-metric="action"]');
  const confidenceValue = panel.querySelector('[data-camera-metric="confidence"]');
  const latencyValue = panel.querySelector('[data-camera-metric="latency"]');
  let current = { phase: 'idle', status: 'idle', message: '説明を確認して開始してください。カメラはまだ起動していません。' };
  let destroyed = false;

  const callbacks = { start: onStart, stop: onStop, capture: onCapture, undo: onUndo };
  const handleClick = (event) => {
    const button = event.target.closest?.('button[data-camera-action]');
    if (!button || !panel.contains(button) || button.disabled || destroyed) return;
    callbacks[button.dataset.cameraAction]?.();
  };

  function setState(update = {}) {
    if (destroyed) return;
    current = { ...current, ...update };
    const status = Object.hasOwn(STATUS_LABELS, current.status) ? current.status : 'idle';
    const active = ['starting', 'capturing', 'judging', 'result'].includes(status);
    const busy = ['starting', 'capturing', 'judging'].includes(status);
    panel.dataset.cameraStatus = status;
    panel.setAttribute('aria-busy', String(busy));
    badge.textContent = STATUS_LABELS[status];
    const presentationStopped = current.phase === 'stopped';
    startButton.disabled = active || presentationStopped;
    startButton.textContent = presentationStopped ? '再準備してからカメラを開始' : current.phase !== 'idle' && (status === 'error' || status === 'stopped') ? '同意してカメラを再開' : '同意してカメラを開始';
    stopButton.disabled = presentationStopped;
    captureButton.disabled = presentationStopped || !active || busy;
    placeholder.hidden = active;
    placeholder.textContent = status === 'stopped' ? 'カメラを停止しました' : status === 'error' ? 'カメラの状態を確認してください' : '開始後に映像を表示';
    statusText.textContent = presentationStopped ? '発表は終了しています。「はじめから」で準備に戻ると、カメラを開始できます。' : current.message || STATUS_LABELS[status];
    actionValue.textContent = current.action == null || current.action === ''
      ? '—' : ACTION_LABELS[current.action] ?? String(current.action);
    confidenceValue.textContent = typeof current.confidence === 'number' && Number.isFinite(current.confidence)
      ? `${Math.round(current.confidence <= 1 ? current.confidence * 100 : current.confidence)}%` : '—';
    latencyValue.textContent = typeof current.latencyMs === 'number' && Number.isFinite(current.latencyMs)
      ? `${Math.max(0, Math.round(current.latencyMs))} ms` : '—';
  }

  panel.addEventListener('click', handleClick);
  container.append(panel);
  setState();

  return {
    video,
    setState,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      panel.removeEventListener('click', handleClick);
      panel.remove();
    },
  };
}
