import { createController } from './controller.js';
import { createPresentationState, transitionPresentation } from './state/presentation.js';
import { createManualEvent, parseCommand, commandForKey } from './input/manual.js';
import { mountPresentation } from './ui/view.js';
import { createCameraInput } from './input/camera.js';
import { mountCameraPanel } from './ui/camera-panel.js';
import { createSpeechInput } from './input/speech.js';
import { mountSpeechPanel } from './ui/speech-panel.js';
import { bindInputLifecycle } from './input/lifecycle.js';

const root = document.getElementById('app');
let controller;
let camera;
let speech;
let inputMode = null;
const view = mountPresentation(root, dispatchIntent);

function dispatchIntent(type, payload = {}) {
  if (type === 'COMMAND') {
    const intent = parseCommand(payload.text);
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
  if (next !== previous && (type === 'STOP' || type === 'RESTART')) { inputMode = null; camera?.stop(); speech?.stop(); }
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
  }
}

controller = createController({
  initialState: createPresentationState(),
  transition: transitionPresentation,
  render: view.render,
});

const cameraContainer = document.createElement('section');
cameraContainer.setAttribute('aria-label', 'AIカメラ操作');
root.prepend(cameraContainer);
const cameraPanel = mountCameraPanel(cameraContainer, {
  onStart() {
    if (controller.getState().phase === 'idle') dispatchIntent('START');
    if (controller.getState().phase !== 'presenting') {
      cameraPanel.setState({status: 'error', message: '「はじめから」で発表を準備してから再開してください。'});
      return;
    }
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
  onStatus: cameraPanel.setState,
  onDecision(event) {
    if (inputMode !== 'camera') return false;
    const previous = controller.getState();
    const next = controller.dispatch(event);
    view.announce(next === previous
      ? '今の画面では移動できません。最初・最後の工程、または寄り道の確認状態をご確認ください。'
      : `AIカメラの判定で${event.type === 'NEXT' ? '次の' : '前の'}工程へ移りました。取り消しもできます。`);
  },
});
const speechContainer = document.createElement('section');
speechContainer.setAttribute('aria-label', '音声操作');
root.prepend(speechContainer);
const speechPanel = mountSpeechPanel(speechContainer, {
  onStart() {
    if (!speech.supported) { speech.start(); return; }
    if (controller.getState().phase === 'idle') dispatchIntent('START');
    if (controller.getState().phase !== 'presenting') { speech.start(); return; }
    inputMode = 'voice';
    camera.stop('音声操作へ切り替えたためカメラと画像送信を停止しました。手を使うときはカメラの開始ボタンを押してください。');
    speech.start();
  },
  onStop: () => speech.stop(),
});
speech = createSpeechInput({
  getState: controller.getState,
  onStatus: speechPanel.setState,
  onDecision(event) {
    if (inputMode !== 'voice') return false;
    const previous = controller.getState();
    const next = controller.dispatch(event);
    if (next !== previous && event.type === 'STOP') { inputMode = null; camera.stop(); speech.stop(); }
    view.announce(next === previous ? '今の画面ではこの音声操作は使えません。工程や寄り道の状態を確認してください。' : next.message);
    return next !== previous;
  },
});
if (!speech.supported) speechPanel.setState({supported:false,status:'unsupported',message:'このブラウザは音声認識に対応していません。Chromeなどの対応ブラウザ、または文字入力を使ってください。'});
bindInputLifecycle({ window, document, inputs: [camera, speech] });

document.addEventListener('keydown', (event) => {
  const intent = commandForKey(event);
  if (!intent) return;
  event.preventDefault();
  dispatchIntent(intent.type);
});
