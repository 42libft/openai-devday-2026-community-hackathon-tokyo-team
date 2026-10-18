export function mountDeckUpload(container, { onSelect, onCancel, onReset }) {
  container.innerHTML = `
    <section class="deck-upload" aria-labelledby="deck-heading">
      <h3 id="deck-heading">自分のスライドで発表</h3>
      <p>PDF・PowerPoint（PPTX）を選択してください。25MB・100ページまで。ファイルは端末内で読み込み、サーバーへ送信しません。</p>
      <label for="deck-file">スライドファイル</label>
      <input id="deck-file" type="file" accept=".pdf,.pptx,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation">
      <div class="deck-actions">
        <button type="button" class="button-secondary" id="deck-cancel" hidden>読み込みをキャンセル</button>
        <button type="button" class="button-secondary" id="deck-reset" hidden>サンプル台本に戻す</button>
      </div>
      <p id="deck-status" role="status" aria-live="polite">ファイルを選ぶと先頭ページをプレビューできます。</p>
      <p class="field-hint">発表開始前に選択できます。読み込んだファイルは再読み込みで消えます。PPTXのフォント・配置は原本と異なる場合があります。見た目を揃える場合はPDFをお使いください。</p>
    </section>`;
  const get = selector => container.querySelector(selector);
  const input = get('#deck-file'), cancel = get('#deck-cancel'), reset = get('#deck-reset'), status = get('#deck-status');
  input.addEventListener('change', () => { const file = input.files?.[0]; input.value = ''; if (file) onSelect(file); });
  cancel.addEventListener('click', onCancel); reset.addEventListener('click', onReset);
  let busy = false, phase = 'idle', hasDeck = false;
  return {
    setState(update = {}) {
      if ('busy' in update) busy = update.busy;
      if ('phase' in update) phase = update.phase;
      if ('hasDeck' in update) hasDeck = update.hasDeck;
      if ('message' in update) status.textContent = update.message;
      if ('error' in update) status.classList.toggle('is-error', update.error);
      container.hidden = phase !== 'idle';
      input.disabled = phase !== 'idle'; // A new selection supersedes an in-flight import.
      cancel.hidden = !busy;
      reset.hidden = !hasDeck; reset.disabled = busy || phase !== 'idle';
      container.setAttribute('aria-busy', String(busy));
    },
  };
}
