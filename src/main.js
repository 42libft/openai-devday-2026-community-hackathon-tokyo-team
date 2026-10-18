import { createController } from './controller.js';
import { createPresentationState, transitionPresentation } from './state/presentation.js';
import { createManualEvent, parseCommand, commandForKey } from './input/manual.js';
import { mountPresentation } from './ui/view.js';
import { createCameraInput } from './input/camera.js';
import { mountCameraPanel } from './ui/camera-panel.js';

const root = document.getElementById('app');
let controller;
let camera;
const view = mountPresentation(root, dispatchIntent);

function dispatchIntent(type, payload = {}) {
  if (type === 'STOP' || type === 'RESTART') camera?.stop();
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
window.addEventListener('pagehide', () => camera.dispose());
document.addEventListener('visibilitychange', () => { if (document.hidden) camera.stop(); });

document.addEventListener('keydown', (event) => {
  const intent = commandForKey(event);
  if (!intent) return;
  event.preventDefault();
  dispatchIntent(intent.type);
});
