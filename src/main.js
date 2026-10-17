const button = document.getElementById('smoke-button');
const status = document.getElementById('smoke-status');

button.addEventListener('click', () => {
  status.textContent = 'JavaScriptの動作を確認しました。';
});
