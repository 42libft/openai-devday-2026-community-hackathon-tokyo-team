const LABELS = {
  idle: '開始前', starting: '準備中', listening: '聞き取り中', capturing: '映像受付中',
  judging: '判定中', result: '操作中', stopped: '停止中',
  unsupported: '非対応', error: 'エラー・設定を確認',
};

/** Keep input status and a manual escape visible while detailed settings are closed. */
export function mountInputSettings(root, {onManual}) {
  const strip = document.createElement('section');
  strip.className = 'input-strip';
  strip.setAttribute('aria-label', '入力の状態と切り替え');
  strip.innerHTML = `<p role="status" aria-live="polite"><span data-input-status="speech">音声：開始前</span><span data-input-status="camera">カメラ：開始前</span></p>
    <button type="button" class="button-secondary" data-input-settings>音声・カメラを設定</button>
    <button type="button" class="button-quiet" data-manual-input>手動に切り替え</button>`;
  const settings = document.createElement('details');
  settings.className = 'input-settings';
  settings.innerHTML = '<summary>音声・カメラの詳しい設定</summary>';
  const speechContainer = document.createElement('section');
  speechContainer.setAttribute('aria-label', '音声操作');
  const cameraContainer = document.createElement('section');
  cameraContainer.setAttribute('aria-label', 'AIカメラ操作');
  settings.append(speechContainer, cameraContainer);
  root.prepend(strip);
  root.append(settings);
  strip.querySelector('[data-input-settings]').addEventListener('click', () => {
    settings.open = true;
    settings.scrollIntoView({block: 'start'});
  });
  const showPresentation = () => {
    settings.open = false;
    root.scrollIntoView({block: 'start'});
  };
  strip.querySelector('[data-manual-input]').addEventListener('click', () => {
    onManual();
    showPresentation();
  });
  return {
    speechContainer, cameraContainer, showPresentation,
    setStatus(source, update) {
      const label = strip.querySelector(`[data-input-status="${source}"]`);
      if (!label || !update.status) return;
      label.textContent = `${source === 'camera' ? 'カメラ' : '音声'}：${LABELS[update.status] ?? '状態を確認'}`;
      label.dataset.error = String(update.status === 'error');
      label.title = update.message ?? '';
    },
  };
}
