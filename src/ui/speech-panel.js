const LABELS = {idle:'開始前', starting:'マイクを準備中', listening:'聞き取り中', stopped:'音声停止中', unsupported:'音声非対応', error:'確認が必要です'};

export function mountSpeechPanel(container, {onStart, onStop}) {
  container.className = 'speech-panel';
  container.innerHTML = `<div class="speech-heading"><h2>声で操作する</h2><span data-speech-status-label>開始前</span></div>
    <p class="speech-consent">開始するとカメラと画像送信を停止します。音声はブラウザ提供元の認識サービスへ送られる場合があります。このアプリは音声を保存しません。</p>
    <div class="speech-controls"><button type="button" class="button-primary" data-speech-action="start">同意して音声を開始</button><button type="button" class="button-secondary" data-speech-action="stop">音声を停止</button><p>「次へ」「前へ」「取り消し」「続きへ」「停止」</p></div>
    <p class="speech-live-status" role="status" aria-live="polite">開始ボタンを押したときだけマイクを使います。</p>
    <p class="speech-transcript">聞き取った言葉：<span>—</span></p>`;
  const start = container.querySelector('[data-speech-action="start"]');
  const stop = container.querySelector('[data-speech-action="stop"]');
  start.addEventListener('click', onStart); stop.addEventListener('click', onStop);
  let state = {phase:'idle',status:'idle', transcript:'', supported:true};
  function setState(update) {
    state = {...state,...update};
    if(state.status==='unsupported')state.supported=false;
    if(!state.supported)state.status='unsupported';
    container.dataset.speechStatus = state.status;
    container.querySelector('[data-speech-status-label]').textContent = LABELS[state.status] ?? LABELS.idle;
    if (state.message || state.phase === 'stopped') container.querySelector('.speech-live-status').textContent = state.phase === 'stopped' ? '発表は終了しています。「はじめから」で準備に戻ってから音声を開始してください。' : state.message;
    container.querySelector('.speech-transcript span').textContent = state.transcript || '—';
    start.disabled = state.phase === 'stopped' || !state.supported || ['starting','listening'].includes(state.status);
    start.textContent = state.phase === 'stopped' ? '再準備してから音声を開始' : !state.supported ? '音声非対応' : ['error','stopped'].includes(state.status) ? '同意して音声を再開' : '同意して音声を開始';
  }
  setState({});
  return {setState, destroy() {start.removeEventListener('click',onStart);stop.removeEventListener('click',onStop);container.remove();}};
}
