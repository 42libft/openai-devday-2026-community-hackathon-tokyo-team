let editorCount = 0;

function requireThreeSteps(steps) {
  if (!Array.isArray(steps) || steps.length !== 3) {
    throw new TypeError('台本エディターには3工程が必要です。');
  }
}

export function mountScriptEditor(container, {steps, message = '', onSave}) {
  requireThreeSteps(steps);
  const document = container.ownerDocument;
  const editorId = `script-editor-${++editorCount}`;
  const details = document.createElement('details');
  details.className = 'script-editor-details';
  const summary = document.createElement('summary');
  summary.textContent = '自分の台本を編集';
  const content = document.createElement('div');
  content.className = 'script-editor-content';
  const description = document.createElement('p');
  description.className = 'script-editor-description';
  description.id = `${editorId}-description`;
  description.textContent = '3工程のタイトル・本文を編集し、保存すると発表に反映されます。このブラウザだけに保存し、外部送信はしません。';
  const form = document.createElement('form');
  form.className = 'script-editor-form';
  form.setAttribute('aria-describedby', description.id);

  const fields = Array.from({length: 3}, (_, index) => {
    const group = document.createElement('fieldset');
    group.className = 'script-editor-step';
    const legend = document.createElement('legend');
    legend.textContent = `${index + 1}枚目`;
    group.append(legend);

    const titleLabel = document.createElement('label');
    titleLabel.htmlFor = `${editorId}-title-${index}`;
    titleLabel.textContent = `${index + 1}枚目のタイトル`;
    const title = document.createElement('input');
    title.id = titleLabel.htmlFor;
    title.name = `title-${index + 1}`;
    title.type = 'text';
    title.maxLength = 80;
    title.required = true;

    const scriptLabel = document.createElement('label');
    scriptLabel.htmlFor = `${editorId}-script-${index}`;
    scriptLabel.textContent = `${index + 1}枚目の台本`;
    const script = document.createElement('textarea');
    script.id = scriptLabel.htmlFor;
    script.name = `script-${index + 1}`;
    script.maxLength = 4000;
    script.rows = 4;
    script.required = true;

    group.append(titleLabel, title, scriptLabel, script);
    form.append(group);
    return {title, script};
  });

  const actions = document.createElement('div');
  actions.className = 'script-editor-actions';
  const save = document.createElement('button');
  save.type = 'submit';
  save.className = 'button-primary';
  save.textContent = '台本を保存して反映';
  const status = document.createElement('p');
  status.className = 'script-editor-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.setAttribute('aria-atomic', 'true');
  actions.append(save, status);
  form.append(actions);
  content.append(description, form);
  details.append(summary, content);
  container.classList.add('script-editor');
  container.replaceChildren(details);

  let ids;
  let disabled = false;
  function setState(update = {}) {
    if (Object.hasOwn(update, 'steps')) {
      requireThreeSteps(update.steps);
      ids = update.steps.map(step => step.id);
      fields.forEach((field, index) => {
        field.title.value = update.steps[index].title;
        field.script.value = update.steps[index].script;
      });
    }
    if (Object.hasOwn(update, 'message')) status.textContent = update.message ?? '';
    if (Object.hasOwn(update, 'disabled')) {
      disabled = Boolean(update.disabled);
      fields.forEach(field => {
        field.title.disabled = disabled;
        field.script.disabled = disabled;
      });
      save.disabled = disabled;
    }
  }
  function submit(event) {
    event.preventDefault();
    if (disabled || !form.reportValidity()) return;
    onSave(fields.map((field, index) => ({
      id: ids[index],
      title: field.title.value,
      script: field.script.value,
    })));
  }
  function markUnsaved() {
    if (!disabled) status.textContent = '未保存の変更があります。「台本を保存して反映」を押してください。';
  }
  form.addEventListener('submit', submit);
  form.addEventListener('input', markUnsaved);
  setState({steps, message});

  return {
    setState,
    destroy() {
      form.removeEventListener('submit', submit);
      form.removeEventListener('input', markUnsaved);
      details.remove();
      container.classList.remove('script-editor');
    },
  };
}
