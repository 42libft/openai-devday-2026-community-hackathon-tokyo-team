import { createController } from './controller.js';
import { createPresentationState, transitionPresentation } from './state/presentation.js';
import { createManualEvent, commandForKey } from './input/manual.js';
import { mountPresentation } from './ui/view.js';
import { createCameraInput } from './input/camera.js';
import { mountCameraPanel } from './ui/camera-panel.js';
import { createSpeechInput } from './input/speech.js';
import { mountSpeechPanel } from './ui/speech-panel.js';
import { bindInputLifecycle } from './input/lifecycle.js';
import { mountInputSettings } from './ui/input-settings.js';
import { createUploadSession, createSlidePresenter } from './slides/upload.js';
import { loadSlideDeck } from './slides/deck.js';
import { mountDeckUpload } from './ui/deck-upload.js';
import './slides.css';
import './slide-import.css';

const root = document.getElementById('app');
let controller;
let camera;
let speech;
let inputMode = null;
let cameraPanel;
let speechPanel;
let uploadedDeck = null;
let uploadPanel;
let upload;
let slidePresenter;
const view = mountPresentation(root, dispatchIntent, {
  getDeck: () => uploadedDeck,
  onRenderSlide(deck, index, container) {
    slidePresenter ??= createSlidePresenter(container, message => { view.announce(message); view.setSlideError(true); });
    void slidePresenter.show(deck, index);
  },
});

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
  const previous = controller.getState();
  const next = controller.dispatch(createManualEvent(type, previous, payload));
  if (next !== previous && (type === 'STOP' || type === 'RESTART')) {
    if (upload?.busy) upload.cancel();
    inputMode = null; camera?.stop(); speech?.stop();
  }
  if (next === previous) {
    const reason = previous.phase === 'idle'
      ? 'スライドを読み込み、内容を確認して開始してください。'
      : previous.phase === 'stopped'
        ? '停止中です。「はじめから」で新しく開始できます。'
        : type === 'UNDO' ? '取り消せる操作はありません。'
          : type === 'RESUME' ? '戻り先はありません。質問への寄り道中に使えます。'
            : type === 'NEXT' ? '最後のスライドです。'
              : type === 'PREVIOUS' ? '最初のスライドです。'
                  : '今の状態ではこの操作は使えません。表示中のボタンを確認してください。';
    view.announce(reason);
  }
}

controller = createController({
  initialState: createPresentationState(),
  transition: transitionPresentation,
  render(state) {
    view.render(state);
    cameraPanel?.setState({phase: state.phase});
    speechPanel?.setState({phase: state.phase});
    uploadPanel?.setState({phase: state.phase, hasDeck: Boolean(uploadedDeck)});
  },
});

function applyDeck(deck) {
  const state = controller.getState();
  if (state.phase !== 'idle') return;
  const slides = deck.steps.map((step, index) => ({id: `page-${index + 1}`, title: step.title, notes: ''}));
  const previous = uploadedDeck;
  uploadedDeck = deck;
  const next = controller.dispatch(createManualEvent('LOAD_DECK', state, {slides}));
  if (next === state) { uploadedDeck = previous; throw new Error('資料のページ情報を確認できません。'); }
  inputMode = null; camera?.stop(); speech?.stop();
  previous?.destroy();
  uploadPanel.setState({hasDeck: true, message: `${deck.name}（${slides.length}枚）を読み込みました。内容を確認して開始してください。`, error: false});
}
uploadPanel = mountDeckUpload(root.querySelector('#deck-upload-slot'), {
  onSelect: file => { if (controller.getState().phase === 'idle') void upload.select(file); },
  onCancel: () => upload.cancel(),
});
upload = createUploadSession({
  load: loadSlideDeck,
  canApply: () => controller.getState().phase === 'idle',
  onBusy: busy => {
    uploadPanel.setState({busy});
    const state = controller.getState();
    root.querySelector('[data-event="START"]').disabled = busy || state.phase !== 'idle' || !state.stepCount;
  },
  onApply: applyDeck,
  onMessage: (message, error = false) => uploadPanel.setState({message, error}),
});

const inputSettings = mountInputSettings(root, {
  onManual() {
    inputMode = null;
    camera?.stop(); speech?.stop();
    view.announce('音声とカメラを停止しました。画面のボタンで発表を続けられます。');
  },
});
const cameraContainer = inputSettings.cameraContainer;
cameraPanel = mountCameraPanel(cameraContainer, {
  onStart() {
    if (upload.busy) { view.announce('スライドの読み込み完了後にカメラを開始してください。'); return; }
    if (controller.getState().phase === 'idle') dispatchIntent('START');
    if (controller.getState().phase !== 'presenting') {
      cameraPanel.setState({status: 'error', message: '「はじめから」で発表を準備してから再開してください。'});
      return;
    }
    inputSettings.showPresentation();
    inputMode = 'camera';
    speech.stop('カメラ操作へ切り替えたため音声を停止しました。声を使うときは音声の開始ボタンを押してください。');
    camera.start();
  },
  onStop: () => camera.stop(),
  onCapture: () => camera.capture(),
  onUndo: () => dispatchIntent('UNDO'),
});
camera = createCameraInput({
  video: cameraPanel.video,
  getState: controller.getState,
  onStatus(update) { cameraPanel.setState(update); inputSettings.setStatus('camera', update); },
  onDecision(event) {
    if (inputMode !== 'camera') return false;
    const previous = controller.getState();
    const next = controller.dispatch(event);
    view.announce(next === previous
      ? '今の画面では移動できません。最初・最後のスライド、または寄り道の確認状態をご確認ください。'
      : `AIカメラの判定で${event.type === 'NEXT' ? '次の' : '前の'}スライドへ移りました。取り消しもできます。`);
  },
});
const speechContainer = inputSettings.speechContainer;
speechPanel = mountSpeechPanel(speechContainer, {
  onStart() {
    if (upload.busy) { view.announce('スライドの読み込み完了後に音声を開始してください。'); return; }
    if (!speech.supported) { speech.start(); return; }
    if (controller.getState().phase === 'idle') dispatchIntent('START');
    if (controller.getState().phase !== 'presenting') {
      speechPanel.setState({status: 'stopped', message: '「はじめから」で発表を準備してから音声を開始してください。'});
      return;
    }
    inputSettings.showPresentation();
    inputMode = 'voice';
    camera.stop('音声操作へ切り替えたためカメラと画像送信を停止しました。手を使うときはカメラの開始ボタンを押してください。');
    speech.start();
  },
  onStop: () => speech.stop(),
});
speech = createSpeechInput({
  getState: controller.getState,
  onStatus(update) { speechPanel.setState(update); inputSettings.setStatus('speech', update); },
  onDecision(event) {
    if (inputMode !== 'voice') return false;
    const previous = controller.getState();
    const next = controller.dispatch(event);
    if (next !== previous && event.type === 'STOP') { inputMode = null; camera.stop(); speech.stop(); }
    view.announce(next === previous ? '今の画面ではこの音声操作は使えません。スライドや寄り道の状態を確認してください。' : next.message);
    return next !== previous;
  },
});
if (!speech.supported) {
  inputSettings.setStatus('speech', {status:'unsupported'});
  speechPanel.setState({supported:false,status:'unsupported',message:'このブラウザは音声認識に対応していません。Chromeなどの対応ブラウザ、またはボタン・キーボードを使ってください。'});
}
bindInputLifecycle({ window, document, inputs: [camera, speech] });

document.addEventListener('keydown', (event) => {
  const intent = commandForKey(event);
  if (!intent) return;
  event.preventDefault();
  dispatchIntent(intent.type);
});
