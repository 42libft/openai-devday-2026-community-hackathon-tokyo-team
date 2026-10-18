import { createController } from './controller.js';
import { STEPS, createPresentationState, transitionPresentation } from './state/presentation.js';
import { createManualEvent, parseCommand, commandForKey } from './input/manual.js';
import { mountPresentation } from './ui/view.js';
import { createCameraInput } from './input/camera.js';
import { mountCameraPanel } from './ui/camera-panel.js';
import { createSpeechInput } from './input/speech.js';
import { mountSpeechPanel } from './ui/speech-panel.js';
import { bindInputLifecycle } from './input/lifecycle.js';
import { mountInputSettings } from './ui/input-settings.js';
import { createScriptStore } from './script/storage.js';
import { mountScriptEditor } from './ui/script-editor.js';
import { createUploadSession, createSlidePresenter } from './slides/upload.js';
import { loadSlideDeck } from './slides/deck.js';
import { mountDeckUpload } from './ui/deck-upload.js';
import './slides.css';
import './input-status.css';

const root = document.getElementById('app');
let controller;
let camera;
let speech;
let inputMode = null;
let inputSettings;
let cameraPanel;
let speechPanel;
let scriptEditor;
let uploadedDeck = null;
let uploadPanel;
let upload;
let slidePresenter;
const scriptStore = createScriptStore(STEPS);
const savedScript = scriptStore.load();
let activeSteps = savedScript.steps;
let scriptSource = savedScript.source;
const view = mountPresentation(root, dispatchIntent, {
  getSteps: () => activeSteps,
  hasCustomScript: () => scriptSource !== 'sample',
  getDeck: () => uploadedDeck,
  onRenderSlide(deck, index, container) {
    slidePresenter ??= createSlidePresenter(container, message => { view.announce(message); view.setSlideError(true); });
    void slidePresenter.show(deck, index);
  },
});

function setInputMode(mode) { inputMode = mode; inputSettings?.setMode(mode); }

function dispatchIntent(type, payload = {}) {
  if (type === 'RENDER_RETRY') {
    view.setSlideError(false);
    void slidePresenter?.show(uploadedDeck, controller.getState().step);
    return;
  }
  if (type === 'START' && upload?.busy) {
    view.announce('スライドの読み込みが終わるまでお待ちください。キャンセルもできます。');
    return;
  }
  if (type === 'COMMAND') {
    const intent = parseCommand(payload.text, {stepCount: controller.getState().stepCount});
    if (!intent) {
      view.announce('対応する操作が見つかりません。「次へ」「取り消し」「続きへ」など、表示された言葉を入力してください。画面は変更していません。');
      return;
    }
    const { type: command, ...parameters } = intent;
    dispatchIntent(command, parameters);
    return;
  }
  const previous = controller.getState();
  const next = controller.dispatch(createManualEvent(type, previous, payload));
  if (next !== previous && (type === 'STOP' || type === 'RESTART')) {
    if (upload?.busy) upload.cancel();
    setInputMode(null); camera?.stop(); speech?.stop();
  }
  if (next === previous) {
    const reason = previous.phase === 'idle'
      ? 'まず台本を確認して開始してください。'
      : previous.phase === 'stopped'
        ? '停止中です。「はじめから」で新しく開始できます。'
        : type === 'UNDO' ? '取り消せる操作はありません。'
          : type === 'RESUME' ? '戻り先はありません。質問への寄り道中に使えます。'
            : type === 'NEXT' ? '最後の工程です。'
              : type === 'PREVIOUS' ? '最初の工程です。'
                : type === 'SEARCH' ? '検索語は120文字以内で入力してください。'
                  : '今の状態ではこの操作は使えません。表示中のボタンを確認してください。';
    view.announce(reason);
    inputSettings?.setResult('manual', reason);
  } else inputSettings?.setResult('manual', next.message);
}

controller = createController({
  initialState: createPresentationState(),
  transition: transitionPresentation,
  render(state) {
    view.render(state);
    cameraPanel?.setState({phase: state.phase});
    speechPanel?.setState({phase: state.phase});
    inputSettings?.setState({phase: state.phase});
    scriptEditor?.setState({disabled: state.phase !== 'idle'});
    uploadPanel?.setState({phase: state.phase, hasDeck: Boolean(uploadedDeck)});
  },
});

function applyDeck(deck) {
  const previous = uploadedDeck;
  uploadedDeck = deck;
  if (deck) activeSteps = deck.steps;
  else {
    const saved = scriptStore.load();
    activeSteps = saved.steps; scriptSource = saved.source;
    scriptEditor?.setState({steps: activeSteps, message: saved.message});
  }
  const state = controller.getState();
  controller.dispatch(createManualEvent('LOAD_DECK', state, {stepCount: activeSteps.length}));
  previous?.destroy();
  uploadPanel.setState({hasDeck: Boolean(deck), message: deck
    ? `${deck.name}（${activeSteps.length}枚）を読み込みました。内容を確認して開始してください。`
    : 'サンプル台本に戻しました。', error: false});
}
uploadPanel = mountDeckUpload(root.querySelector('#deck-upload-slot'), {
  onSelect: file => { if (controller.getState().phase === 'idle') void upload.select(file); },
  onCancel: () => upload.cancel(),
  onReset: () => { if (controller.getState().phase === 'idle') { upload.cancel(); applyDeck(null); } },
});
upload = createUploadSession({
  load: loadSlideDeck,
  canApply: () => controller.getState().phase === 'idle',
  onBusy: busy => {
    uploadPanel.setState({busy});
    scriptEditor?.setState({disabled: busy || controller.getState().phase !== 'idle'});
    root.querySelector('[data-event="START"]').disabled = busy || controller.getState().phase !== 'idle';
  },
  onApply: applyDeck,
  onMessage: (message, error = false) => uploadPanel.setState({message, error}),
});

scriptEditor = mountScriptEditor(root.querySelector('#script-editor-slot'), {
  steps: activeSteps,
  message: savedScript.message,
  onSave(steps) {
    if (controller.getState().phase !== 'idle' || upload.busy || uploadedDeck) {
      scriptEditor.setState({message: '発表を停止し、「はじめから」で準備に戻ってから編集してください。'});
      return;
    }
    try {
      const saved = scriptStore.save(steps);
      activeSteps = saved.steps;
      scriptSource = saved.source;
      view.render(controller.getState());
      scriptEditor.setState({steps: activeSteps, message: saved.message});
    } catch (error) {
      scriptEditor.setState({message: error.message || '台本を保存できませんでした。入力内容を確認してください。'});
    }
  },
});

function startCamera() {
  if (upload.busy) { view.announce('スライドの読み込み完了後にカメラを開始してください。'); return; }
  if (controller.getState().phase === 'idle') dispatchIntent('START');
  if (controller.getState().phase !== 'presenting') {
    const update={status:'error',message:'「はじめから」で発表を準備してから再開してください。'};
    cameraPanel.setState(update);inputSettings.setStatus('camera',update);return;
  }
  setInputMode('camera');
  speech.stop('カメラ操作へ切り替えたため音声を停止しました。声を使うときは音声の開始ボタンを押してください。');
  inputSettings.showPresentation();camera.start();
}
function startSpeech() {
  if (upload.busy) { view.announce('スライドの読み込み完了後に音声を開始してください。'); return; }
  if (!speech.supported) { speech.start(); return; }
  if (controller.getState().phase === 'idle') dispatchIntent('START');
  if (controller.getState().phase !== 'presenting') {
    const update={status:'stopped',message:'「はじめから」で発表を準備してから音声を開始してください。'};
    speechPanel.setState(update);inputSettings.setStatus('speech',update);return;
  }
  setInputMode('voice');
  camera.stop('音声操作へ切り替えたためカメラと画像送信を停止しました。手を使うときはカメラの開始ボタンを押してください。');
  inputSettings.showPresentation();speech.start();
}
inputSettings = mountInputSettings(root, {
  onCameraStart:startCamera,onSpeechStart:startSpeech,
  onManual() {
    setInputMode(null);camera?.stop();speech?.stop();
    const message='音声とカメラを停止しました。画面のボタンで発表を続けられます。';
    inputSettings.setResult('manual',message);view.announce(message);
  },
});
inputSettings.setState({phase:controller.getState().phase});
const cameraContainer = inputSettings.cameraContainer;
cameraPanel = mountCameraPanel(cameraContainer, {
  onStart:startCamera,
  onStop:()=>camera.stop(),onCapture:()=>camera.capture(),onUndo:()=>dispatchIntent('UNDO'),
});
camera = createCameraInput({
  video: cameraPanel.video,
  getState: controller.getState,
  onStatus(update) { cameraPanel.setState(update); inputSettings.setStatus('camera', update); },
  onDecision(event) {
    if (inputMode !== 'camera') return false;
    const previous = controller.getState();
    const next = controller.dispatch(event);
    const message=next === previous
      ? '今の画面では移動できません。最初・最後の工程、または寄り道の確認状態をご確認ください。'
      : `AIカメラの判定で${event.type === 'NEXT' ? '次の' : '前の'}工程へ移りました。取り消しもできます。`;
    inputSettings.setResult('camera',message);view.announce(message);
    return next !== previous;
  },
});
const speechContainer = inputSettings.speechContainer;
speechPanel = mountSpeechPanel(speechContainer, {onStart:startSpeech,onStop:()=>speech.stop()});
speech = createSpeechInput({
  getState: controller.getState,
  onStatus(update) { speechPanel.setState(update); inputSettings.setStatus('speech', update); },
  onDecision(event) {
    if (inputMode !== 'voice') return false;
    const previous = controller.getState();
    const next = controller.dispatch(event);
    if (next !== previous && event.type === 'STOP') { setInputMode(null); camera.stop(); speech.stop(); }
    const message=next === previous ? '今の画面ではこの音声操作は使えません。工程や寄り道の状態を確認してください。' : next.message;
    inputSettings.setResult('voice',message);view.announce(message);
    return next !== previous;
  },
});
if (!speech.supported) {
  inputSettings.setStatus('speech', {status:'unsupported',supported:false,message:'このブラウザは音声認識に対応していません。Chromeなどの対応ブラウザか、手動操作を使ってください。'});
  speechPanel.setState({supported:false,status:'unsupported',message:'このブラウザは音声認識に対応していません。Chromeなどの対応ブラウザ、または文字入力を使ってください。'});
}
bindInputLifecycle({ window, document, inputs: [camera, speech] });

document.addEventListener('keydown', (event) => {
  if (event.target?.closest?.('dialog[open]')) return;
  const intent = commandForKey(event);
  if (!intent) return;
  event.preventDefault();
  dispatchIntent(intent.type);
});
