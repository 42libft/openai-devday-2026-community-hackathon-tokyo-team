const LABELS = {
  idle: '開始前', starting: '準備中', listening: '聞き取り中', capturing: '映像受付中',
  judging: '判定中', result: '操作中', stopped: '停止中', unsupported: '非対応', error: '確認が必要です',
};
const ACTIONS = {NEXT:'次へ',next:'次へ',PREVIOUS:'前へ',previous:'前へ',NONE:'操作なし',none:'操作なし',UNKNOWN:'判定できません'};
const ACTIVE = {speech:['starting','listening'],camera:['starting','capturing','judging','result']};
let sequence = 0;

/** The presentation keeps readable input feedback; only advanced controls are modal. */
export function mountInputSettings(root, {onManual, onSpeechStart, onCameraStart}) {
  const strip = document.createElement('section');
  strip.className = 'input-strip input-status';
  strip.setAttribute('aria-label', '入力の状態と切り替え');
  const headingId = `input-settings-heading-${++sequence}`;
  strip.innerHTML = `<div class="input-status-heading"><strong data-input-mode>現在の操作：手動</strong><div class="input-status-actions">
    <button type="button" class="button-secondary" data-input-settings>音声・カメラの詳細</button>
    <button type="button" class="button-quiet" data-manual-input>手動に切り替え</button></div></div>
    <p class="input-last-operation" role="status" aria-live="polite" data-last-operation>画面のボタンで操作できます。</p>
    <div class="input-status-sources">${['speech','camera'].map(source => `<section class="input-status-source" data-source="${source}" aria-label="${source==='speech'?'音声':'カメラ'}の状態">
      <strong data-input-status="${source}"></strong><p data-input-message="${source}" role="status" aria-live="polite"></p>
      <p class="input-last-result" data-input-result="${source}"></p>
      <div data-input-recovery="${source}"><p class="input-start-consent">${source==='speech'?'音声はブラウザ提供元へ送信される場合があります。開始するとカメラを停止します。':'カメラの静止画を約2秒おきにOpenAIへ送信します。開始すると音声を停止します。'}</p>
      <button type="button" class="button-secondary" data-input-start="${source}"></button></div></section>`).join('')}</div>`;
  const settings = document.createElement('dialog');
  settings.className = 'input-settings input-settings-dialog';
  settings.setAttribute('aria-labelledby', headingId);
  settings.innerHTML = `<div class="input-dialog-heading"><h2 id="${headingId}">音声・カメラの詳細</h2><button type="button" class="button-secondary" data-close-settings>発表に戻る</button></div>`;
  const speechContainer = document.createElement('section');
  speechContainer.setAttribute('aria-label', '音声操作');
  const cameraContainer = document.createElement('section');
  cameraContainer.setAttribute('aria-label', 'AIカメラ操作');
  settings.append(speechContainer, cameraContainer);
  root.prepend(strip);root.append(settings);
  let mode = 'manual', phase = 'idle', returnFocus = null, returnPosition = null;
  const states = {speech:{status:'idle',supported:true,message:'音声はまだ開始していません。'},camera:{status:'idle',message:'カメラはまだ開始していません。'}};
  const restorePosition = () => {
    if (!returnPosition) return;
    returnFocus?.focus?.({preventScroll:true});
    window.scrollTo?.({left:returnPosition.x,top:returnPosition.y,behavior:'instant'});
    returnFocus=null;returnPosition=null;
  };
  const showPresentation = () => {
    if (!settings.open) return;
    if (settings.close) settings.close();else settings.removeAttribute('open');
    restorePosition();
  };
  strip.querySelector('[data-input-settings]').addEventListener('click', () => {
    returnFocus=document.activeElement;returnPosition={x:window.scrollX,y:window.scrollY};
    if(settings.showModal)settings.showModal();else settings.setAttribute('open','');
  });
  settings.querySelector('[data-close-settings]').addEventListener('click',showPresentation);
  settings.addEventListener('close',restorePosition);
  strip.querySelector('[data-manual-input]').addEventListener('click',()=>{onManual();showPresentation();});
  for(const source of ['speech','camera'])strip.querySelector(`[data-input-start="${source}"]`).addEventListener('click',()=>{
    const button=strip.querySelector(`[data-input-start="${source}"]`);
    if(!button.disabled)(source==='speech'?onSpeechStart:onCameraStart)?.();
  });
  function render() {
    strip.querySelector('[data-input-mode]').textContent=`現在の操作：${mode==='voice'?'音声':mode==='camera'?'カメラ':'手動'}`;
    strip.dataset.inputMode=mode;
    for(const source of ['speech','camera']) {
      const state=states[source], name=source==='speech'?'音声':'カメラ';
      const unsupported=state.supported===false||state.status==='unsupported';
      const status=unsupported?'unsupported':state.status;
      const label=strip.querySelector(`[data-input-status="${source}"]`);
      label.textContent=`${name}：${LABELS[status]??'状態を確認'}`;
      label.dataset.error=String(status==='error'||unsupported);
      strip.querySelector(`[data-input-message="${source}"]`).textContent=phase==='stopped'
        ? '発表は終了しています。「はじめから」で準備に戻ってから開始してください。'
        : state.message||LABELS[status]||'';
      strip.querySelector(`[data-input-result="${source}"]`).textContent=source==='speech'
        ? `最後に聞き取った言葉：${state.lastTranscript||'—'}`
        : `最後の判定：${state.action==null?'—':ACTIONS[state.action]??String(state.action)}`;
      const active=ACTIVE[source].includes(status);
      strip.querySelector(`[data-input-recovery="${source}"]`).hidden=active;
      const start=strip.querySelector(`[data-input-start="${source}"]`);
      start.disabled=active||unsupported||phase==='stopped';
      start.textContent=unsupported?'音声非対応':phase==='stopped'?`再準備してから${name}を開始`:`同意して${name}を${['error','stopped'].includes(status)?'再開':'開始'}`;
    }
  }
  render();
  return {
    speechContainer,cameraContainer,showPresentation,
    setMode(next) {mode=next==='voice'||next==='camera'?next:'manual';render();},
    setState(update) {if(update.phase)phase=update.phase;render();},
    setResult(source,message) {strip.querySelector('[data-last-operation]').textContent=`${source==='voice'?'音声':source==='camera'?'カメラ':'手動'}：${message}`;},
    setStatus(source,update) {
      if(!states[source])return;
      states[source]={...states[source],...update};
      if(source==='speech'&&update.transcript)states[source].lastTranscript=update.transcript;
      // Capability is persistent; stopping another input must not erase it.
      if(update.status==='unsupported')states[source].supported=false;
      render();
    },
  };
}
