import { createController } from './controller.js';
import { STEPS, createPresentationState, transitionPresentation } from './state/presentation.js';
import { createManualEvent, parseCommand, commandForKey } from './input/manual.js';
import { mountPresentation } from './ui/view.js';
import { createCameraInput } from './input/camera.js';
import { mountCameraPanel } from './ui/camera-panel.js';
import { createSpeechInput } from './input/speech.js';
import { mountSpeechPanel } from './ui/speech-panel.js';
import { bindInputLifecycle } from './input/lifecycle.js';
import { createScriptStore } from './script/storage.js';
import { mountScriptEditor } from './ui/script-editor.js';

const root = document.getElementById('app');
let controller;
let camera;
let speech;
let cameraPanel;
let speechPanel;
let scriptEditor;
const scriptStore = createScriptStore(STEPS);
const savedScript = scriptStore.load();
let activeSteps = savedScript.steps;
let scriptSource = savedScript.source;
const view = mountPresentation(root, dispatchIntent, {
  getSteps: () => activeSteps,
  hasCustomScript: () => scriptSource !== 'sample',
});

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
  if (next !== previous && (type === 'STOP' || type === 'RESTART')) { camera?.stop(); speech?.stop(); }
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
  render(state) {
    view.render(state);
    cameraPanel?.setState({phase: state.phase});
    speechPanel?.setState({phase: state.phase});
    scriptEditor?.setState({disabled: state.phase !== 'idle'});
  },
});

scriptEditor = mountScriptEditor(root.querySelector('#script-editor-slot'), {
  steps: activeSteps,
  message: savedScript.message,
  onSave(steps) {
    if (controller.getState().phase !== 'idle') {
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

const cameraContainer = document.createElement('section');
cameraContainer.setAttribute('aria-label', 'AIカメラ操作');
root.prepend(cameraContainer);
cameraPanel = mountCameraPanel(cameraContainer, {
  onStart() {
    if (controller.getState().phase === 'idle') dispatchIntent('START');
    if (controller.getState().phase !== 'presenting') {
      cameraPanel.setState({status: 'error', message: '「はじめから」で発表を準備してから再開してください。'});
      return;
    }
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
speechPanel = mountSpeechPanel(speechContainer, {
  onStart() {
    if (controller.getState().phase === 'idle') dispatchIntent('START');
    if (controller.getState().phase !== 'presenting') {
      speechPanel.setState({status: 'stopped', message: '「はじめから」で発表を準備してから音声を開始してください。'});
      return;
    }
    speech.start();
  },
  onStop: () => speech.stop(),
});
speech = createSpeechInput({
  getState: controller.getState,
  onStatus: speechPanel.setState,
  onDecision(event) {
    const previous = controller.getState();
    const next = controller.dispatch(event);
    if (next !== previous && event.type === 'STOP') { camera.stop(); speech.stop(); }
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
