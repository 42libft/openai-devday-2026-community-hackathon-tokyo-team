import { parseCommand } from './manual.js';

export const SPEECH_ACTIONS = new Set(['NEXT', 'PREVIOUS', 'UNDO', 'RESUME', 'STOP', 'REQUEST_JUMP', 'CONFIRM_JUMP', 'CANCEL_JUMP']);

export function parseSpeechCommand(text) {
  if (typeof text !== 'string' || text.length > 180) return null;
  let normalized = text.normalize('NFKC').trim().replace(/[。、,.!?！？\s]+$/u, '').replace(/\s+/gu, '');
  normalized = normalized.replace(/^相棒[、,]?/u, '');
  const intent = parseCommand(normalized);
  return intent && SPEECH_ACTIONS.has(intent.type) ? intent : null;
}

const ERRORS = {
  'not-allowed': 'マイクが許可されていません。ブラウザのマイク設定を確認し、音声を開始し直してください。',
  'service-not-allowed': 'このブラウザでは音声認識を利用できません。Chromeなどの対応ブラウザ、または文字入力を使ってください。',
  'audio-capture': 'マイクを取得できません。接続や他のアプリでの使用状況を確認してください。',
  'network': '音声認識に接続できません。通信を確認して、音声を開始し直してください。',
  'no-speech': '声を聞き取れず終了しました。音声を開始し直して、短く話してください。',
  'language-not-supported': 'この環境で日本語を認識できません。対応ブラウザか文字入力を使ってください。',
};

/** Explicit consent only. Audio belongs to the browser's recognition service. */
export function createSpeechInput({ getState, onDecision, onStatus,
  Recognition = globalThis.SpeechRecognition ?? globalThis.webkitSpeechRecognition,
  now = Date.now, makeId = () => crypto.randomUUID(),
}) {
  let active = null;
  let disposed = false;
  const supported = typeof Recognition === 'function';
  const notify = update => { if (!disposed) onStatus(update); };
  const frame = () => { const s = getState(); return {sessionEpoch: s.sessionEpoch, baseRevision: s.revision}; };

  function stop(message = '音声を停止しました。再開するときは開始ボタンを押してください。') {
    const previous = active;
    active = null;
    try { previous?.abort(); } catch { /* Already ended. */ }
    notify({status: 'stopped', message});
  }

  function start() {
    if (disposed || active) return;
    if (!supported) {
      notify({status: 'unsupported', message: 'このブラウザは音声認識に対応していません。Chromeなどの対応ブラウザで開くか、文字入力を使ってください。'});
      return;
    }
    if (getState().phase !== 'presenting') {
      notify({status: 'error', message: '発表を開始してから音声を開始してください。'});
      return;
    }
    let recognition;
    try { recognition = new Recognition(); }
    catch { notify({status: 'error', message: '音声認識を準備できませんでした。対応ブラウザか文字入力を使ってください。'}); return; }
    active = recognition;
    const current = () => !disposed && active === recognition;
    const runId = makeId();
    const seen = new Set();
    let captured = null;
    let last = {command: '', at: -Infinity};
    recognition.lang = 'ja-JP';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => { if (current()) notify({status: 'listening', message: '聞き取り中です。「次へ」「前へ」など、操作する言葉だけを話してください。'}); };
    recognition.onspeechstart = () => { if (current()) captured = frame(); };
    recognition.onresult = event => {
      if (!current()) return;
      for (let index = Math.max(0, event.resultIndex ?? 0); index < event.results.length; index++) {
        if (!current()) break;
        const result = event.results[index];
        const rawTranscript = typeof result?.[0]?.transcript === 'string' ? result[0].transcript : '';
        const transcript = rawTranscript.slice(0, 180);
        if (!result?.isFinal) { notify({status: 'listening', transcript, message: '聞き取り中です。確定するまで操作しません。'}); continue; }
        if (seen.has(index)) continue;
        seen.add(index);
        // A result event can contain several finals. Only speechstart arms one
        // final result; accepting or rejecting it must not rebase later results.
        const utterance = captured;
        captured = null;
        if (!utterance) {
          notify({status: 'listening', transcript, message: '一度の発話で受け付ける操作は1つです。次の操作は改めて話してください。'});
          continue;
        }
        const intent = parseSpeechCommand(rawTranscript);
        const state = getState();
        const stale = state.phase !== 'presenting' || state.sessionEpoch !== utterance.sessionEpoch || state.revision !== utterance.baseRevision;
        if (!intent || stale) {
          notify({status: 'listening', transcript, message: stale ? '聞き取り中に画面が変わりました。操作する言葉をもう一度話してください。' : '対応する操作語が見つかりません。「次へ」「取り消し」など、短く話してください。'});
          continue;
        }
        const command = JSON.stringify(intent);
        if (command === last.command && now() - last.at < 1200) {
          notify({status: 'listening', transcript, message: '直前と同じ合図が続いたため、重複する操作を抑えました。'});
          continue;
        }
        last = {command, at: now()};
        notify({transcript});
        const applied = onDecision({...intent, ...utterance, source: 'voice', eventId: `${runId}:${index}`});
        if (current()) notify({status: 'listening', transcript, message: applied === false ? '今の画面ではこの操作を実行できません。画面の案内を確認してください。' : '音声の操作を受け付けました。取り消しもできます。'});
      }
    };
    recognition.onnomatch = () => { if (current()) notify({status: 'listening', message: '聞き取れませんでした。短い操作語でもう一度話してください。'}); };
    recognition.onerror = event => {
      if (!current()) return;
      active = null;
      try { recognition.abort(); } catch { /* Already ended. */ }
      notify({status: 'error', message: ERRORS[event.error] ?? '音声認識が終了しました。通信とマイクを確認して開始し直してください。'});
    };
    recognition.onend = () => {
      if (!current()) return;
      active = null;
      notify({status: 'stopped', message: 'ブラウザの音声認識が終了しました。続けるときは音声を開始し直してください。'});
    };
    notify({status: 'starting', transcript: '', message: 'マイクの許可を確認しています。'});
    try { recognition.start(); }
    catch { if (current()) { active = null; notify({status: 'error', message: '音声認識を開始できませんでした。マイクの許可と対応ブラウザを確認してください。'}); } }
  }
  return {supported, start, stop, dispose() { stop(); disposed = true; }};
}
