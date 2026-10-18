export function mountDeckUpload(container, {onSelect, onCancel}) {
  container.innerHTML = `
    <details class="deck-import" open>
      <summary>スライドを読み込む <span id="deck-current"></span></summary>
      <section class="deck-upload" aria-labelledby="deck-heading">
        <h3 id="deck-heading">PDF / PowerPoint（PPTX）を選択</h3>
        <p>25MB・1〜100ページまで。端末内で処理し、ファイルをサーバーへ送信しません。PPTXの配置やフォントが異なる場合はPDFでお試しください。</p>
        <label for="deck-file">スライドファイル</label>
        <input id="deck-file" type="file" accept=".pdf,.pptx,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation">
        <button type="button" class="button-secondary" id="deck-cancel" hidden>読み込みをキャンセル</button>
        <p id="deck-status" role="status" aria-live="polite">読み込み後、一覧で内容を確認して発表を開始できます。</p>
        <p class="field-hint">資料の変更は準備中にできます。資料・任意ノート・進行はこのタブ内だけで保持し、再読み込みで消えます。ノートは自動生成しません。</p>
      </section>
    </details>`;
  const get = selector => container.querySelector(selector);
  const input=get('#deck-file'),cancel=get('#deck-cancel'),status=get('#deck-status');
  input.addEventListener('change',()=>{const file=input.files?.[0];input.value='';if(file)onSelect(file);});
  cancel.addEventListener('click',onCancel);
  let busy=false,phase='idle',hasDeck=false;
  return {setState(update={}){
    if ('busy' in update) busy=update.busy;
    if ('phase' in update) phase=update.phase;
    if ('hasDeck' in update) {
      const previous=hasDeck;hasDeck=update.hasDeck;
      if (hasDeck && !previous) get('details').open=false;
      get('#deck-current').textContent=hasDeck?'読み込み済み':'';
    }
    if ('message' in update) status.textContent=update.message;
    if ('error' in update) {status.classList.toggle('is-error',update.error);if(update.error)get('details').open=true;}
    container.hidden=phase!=='idle';input.disabled=phase!=='idle';cancel.hidden=!busy;
    container.setAttribute('aria-busy',String(busy));
  }};
}
