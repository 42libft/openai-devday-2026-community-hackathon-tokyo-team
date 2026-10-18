const INTERVAL_MS = 2000;
const TIMEOUT_MS = 12000;
const MIN_CONFIDENCE = 0.9;
const ACTIONS = new Set(['NEXT', 'PREVIOUS', 'NONE']);
const FAILURE_MESSAGES = new Map([
  ['DECISION_REFUSED', 'AIが画像の判定を受け付けませんでした。画像送信を停止しました。映す内容を変えてカメラを再開するか、手動操作で続けてください。'],
  ['INVALID_RESPONSE', 'AIの応答形式を確認できなかったため画像送信を停止しました。時間をおいてカメラを再開するか、手動操作で続けてください。'],
  ['NOT_CONFIGURED', 'AI接続の準備待ちです。運営側のAPIキー設定後に「カメラで開始」で再開してください。'],
  ['UPSTREAM_AUTH', 'AI接続の認証を確認中です。運営側の設定修正後に「カメラで開始」で再開してください。'],
  ['RATE_LIMITED', '利用回数の上限に達しました。1分待ってから「カメラで開始」で再開してください。'],
  ['UPSTREAM_RATE_LIMIT', 'AI判定が混み合っています。1分待ってから「カメラで開始」で再開してください。'],
  ['TIMEOUT', 'AI判定が時間切れになりました。通信を確認し、「カメラで開始」で再開してください。'],
  ['INSECURE_CONTEXT', 'カメラを使うにはHTTPSの公開URLを直接開いてください。開き直してから開始してください。'],
  ['UNSUPPORTED', 'このブラウザーではカメラを利用できません。ChromeまたはSafariで公開URLを直接開いてください。'],
  ['NotAllowedError', 'カメラが許可されていません。ブラウザーと端末のカメラ設定を確認し、許可してから再開してください。'],
  ['SecurityError', 'ブラウザーがカメラ利用を制限しています。公開URLを直接開き、カメラの許可設定を確認してください。'],
  ['NotFoundError', '利用できるカメラが見つかりません。カメラのある端末か接続済みのカメラで再開してください。'],
  ['NotReadableError', 'カメラを読み取れません。他のアプリでの使用や端末のカメラ権限を確認して再開してください。'],
]);
const GENERIC_FAILURE = '判定を続けられませんでした。通信とカメラを確認し、「カメラで開始」で再開してください。';
function codedError(code) { const error = new Error('camera-input'); error.code = code; return error; }

export function validateCameraDecision(result, request, state) {
  if (!result || typeof result !== 'object' || Array.isArray(result)
    || !request || typeof request.requestId !== 'string' || !request.requestId
    || !Number.isSafeInteger(request.sessionEpoch)
    || !Number.isSafeInteger(request.baseRevision)
    || result.requestId !== request.requestId
    || result.sessionEpoch !== request.sessionEpoch
    || result.baseRevision !== request.baseRevision
    || !ACTIONS.has(result.action)
    || typeof result.confidence !== 'number' || !Number.isFinite(result.confidence)
    || result.confidence < 0 || result.confidence > 1) return 'invalid';
  if (state?.phase !== 'presenting' || state.pendingJump != null || state.sessionEpoch !== request.sessionEpoch
    || state.revision !== request.baseRevision) return 'stale';
  return 'valid';
}

export class CameraDecisionGate {
  #active = false;
  #armed = true;
  #seen = new Set();

  start() { this.#active = true; this.#armed = true; this.#seen.clear(); }
  stop() { this.#active = false; this.#armed = false; }

  consume(result, request, state) {
    if (!this.#active) return { kind: 'stopped' };
    const validity = validateCameraDecision(result, request, state);
    if (validity !== 'valid') return { kind: validity };
    if (this.#seen.has(request.requestId)) return { kind: 'duplicate' };
    this.#seen.add(request.requestId);
    if (this.#seen.size > 256) this.#seen.delete(this.#seen.values().next().value);
    if (result.confidence < MIN_CONFIDENCE) return { kind: 'uncertain' };
    if (result.action === 'NONE') {
      this.#armed = true;
      return { kind: 'none' };
    }
    if (!this.#armed) return { kind: 'held' };
    this.#armed = false;
    return {
      kind: 'action',
      event: {
        type: result.action, source: 'camera', eventId: request.requestId,
        sessionEpoch: request.sessionEpoch, baseRevision: request.baseRevision,
      },
    };
  }
}

export function createCameraInput({ video, getState, onDecision, onStatus, fetchImpl = fetch }) {
  const gate = new CameraDecisionGate();
  let stream = null;
  let active = false;
  let starting = false;
  let disposed = false;
  let generation = 0;
  let timer = null;
  let pending = null;
  let endedHandlers = [];
  const report = (status, message, evidence = {}) => onStatus?.({ status, message, ...evidence });

  function releaseTracks() {
    for (const [track, handler] of endedHandlers) track.removeEventListener('ended', handler);
    endedHandlers = [];
    const previous = stream;
    stream = null;
    for (const track of previous?.getTracks() ?? []) track.stop();
    if (video.srcObject === previous) {
      video.pause?.();
      video.srcObject = null;
    }
  }

  function stop(message = 'カメラを停止しました。再開するには「カメラで開始」を押してください。') {
    generation += 1;
    active = false;
    starting = false;
    clearTimeout(timer);
    timer = null;
    if (pending) {
      clearTimeout(pending.timeout);
      pending.controller.abort();
      pending.cancel();
      pending = null;
    }
    gate.stop();
    releaseTracks();
    report('stopped', message);
  }

  function fail(message) {
    stop(message);
    report('error', message);
  }

  function schedule(token) {
    if (!active || token !== generation) return;
    clearTimeout(timer);
    timer = setTimeout(() => { void capture(); }, INTERVAL_MS);
  }

  async function capture() {
    if (!active || pending || disposed) return false;
    clearTimeout(timer);
    timer = null;
    const token = generation;
    const state = getState();
    if (state.phase !== 'presenting' || state.pendingJump != null) { schedule(token); return false; }
    if (!video.videoWidth || !video.videoHeight) {
      report('capturing', '映像の準備中です。カメラに手が映るようにしてください。');
      schedule(token);
      return false;
    }
    const request = {
      requestId: crypto.randomUUID(), sessionEpoch: state.sessionEpoch, baseRevision: state.revision,
    };
    const startedAt = Date.now();
    const controller = new AbortController();
    let cancel;
    const interruption = new Promise((_, reject) => {
      cancel = (code = 'CANCELLED') => reject(codedError(code));
    });
    void interruption.catch(() => {});
    const task = { controller, cancel, timeout: null };
    pending = task;
    try {
      const canvas = video.ownerDocument.createElement('canvas');
      canvas.width = Math.min(480, video.videoWidth);
      canvas.height = Math.max(1, Math.round(video.videoHeight * canvas.width / video.videoWidth));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('canvas');
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageDataUrl = canvas.toDataURL('image/jpeg', 0.65);
      if (!imageDataUrl.startsWith('data:image/jpeg;base64,')) throw new Error('image');
      report('judging', '静止画をDecisionsで判定しています。', { requestId: request.requestId });
      if (!active || token !== generation) return false;
      task.timeout = setTimeout(() => { cancel('TIMEOUT'); controller.abort(); }, TIMEOUT_MS);
      const result = await Promise.race([
        (async () => {
          const response = await fetchImpl('/api/decide', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...request, imageDataUrl }), signal: controller.signal,
          });
          if (!response.ok) {
            let errorBody;
            try { errorBody = await response.json(); } catch { /* Never display a raw response. */ }
            const reportedCode = errorBody?.error?.code;
            const code = FAILURE_MESSAGES.has(reportedCode) ? reportedCode
              : response.status === 429 ? 'RATE_LIMITED' : response.status === 504 ? 'TIMEOUT' : 'REQUEST_FAILED';
            throw codedError(code);
          }
          return response.json();
        })(),
        interruption,
      ]);
      if (!active || token !== generation || pending !== task) return false;
      const verdict = gate.consume(result, request, getState());
      const evidence = {
        requestId: request.requestId, latencyMs: Date.now() - startedAt,
      };
      if (ACTIONS.has(result?.action)) evidence.action = result.action;
      if (Number.isFinite(result?.confidence)) evidence.confidence = result.confidence;
      if (verdict.kind === 'action') {
        report('result', `${result.action === 'NEXT' ? '次へ' : '前へ'}の合図です。一度手を下ろしてください。`, evidence);
        if (active && token === generation
          && validateCameraDecision(result, request, getState()) === 'valid') onDecision(verdict.event);
      } else if (verdict.kind === 'none') {
        report('result', '合図を待っています。次の合図を出せます。', evidence);
      } else if (verdict.kind === 'held') {
        report('result', '同じ合図を連続実行しません。一度手を下ろしてください。', evidence);
      } else if (verdict.kind === 'uncertain') {
        report('result', '合図を確定できません。手をはっきり映してください。', evidence);
      } else {
        report('result', '現在の発表に一致しない判定を破棄しました。次の合図をお待ちください。', evidence);
      }
      return verdict.kind === 'action';
    } catch (error) {
      if (active && token === generation) {
        fail(FAILURE_MESSAGES.get(error?.code) ?? GENERIC_FAILURE);
      }
      return false;
    } finally {
      clearTimeout(task.timeout);
      if (pending === task) pending = null;
      schedule(token);
    }
  }

  async function start() {
    if (disposed || starting) return false;
    if (active) return true;
    const token = ++generation;
    starting = true;
    report('starting', 'カメラの利用を許可してください。マイクは使用しません。');
    if (token !== generation || disposed) return false;
    try {
      if (globalThis.isSecureContext === false) throw codedError('INSECURE_CONTEXT');
      if (!globalThis.navigator?.mediaDevices?.getUserMedia) throw codedError('UNSUPPORTED');
      const obtained = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      if (token !== generation || disposed) {
        for (const track of obtained.getTracks()) track.stop();
        return false;
      }
      stream = obtained;
      for (const track of stream.getTracks()) {
        const handler = () => {
          if (token === generation) fail('カメラの接続が終了しました。接続と権限を確認し、「カメラで開始」で再開してください。');
        };
        track.addEventListener('ended', handler);
        endedHandlers.push([track, handler]);
        if (track.readyState === 'ended') throw new Error('ended');
      }
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      await video.play();
      if (token !== generation || disposed) return false;
      starting = false;
      active = true;
      gate.start();
      report('capturing', 'カメラを開始しました。約2秒ごとに静止画を送って合図を判定します。');
      schedule(token);
      return true;
    } catch (error) {
      if (token === generation) {
        fail(FAILURE_MESSAGES.get(error?.code) ?? FAILURE_MESSAGES.get(error?.name)
          ?? 'カメラを開始できません。ブラウザーのカメラ許可と接続を確認し、もう一度開始してください。');
      }
      return false;
    }
  }

  function dispose() { stop(); disposed = true; }
  return { start, stop, capture, dispose };
}
