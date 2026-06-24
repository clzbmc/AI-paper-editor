import { saveCurrentFile } from './editor.js?v=20260625-draft-generator';
import { els, showToast, state } from './state.js?v=20260625-draft-generator';
import { uiText } from './ui_language.js?v=20260625-draft-generator';

export function renderFeedback(data) {
  const items = data.feedback || [];
  if (!items.length) {
    els.feedbackList.replaceChildren(Object.assign(document.createElement('p'), { textContent: uiText('assist.feedbackEmpty') }));
    return;
  }
  els.feedbackList.replaceChildren(...items.slice(0, 10).map((item, index) => {
    const article = document.createElement('article');
    article.className = `feedback-item ${item.severity || 'low'}`;
    article.style.setProperty('--feedback-index', index);
    const head = document.createElement('div');
    head.className = 'feedback-item-head';
    const meta = document.createElement('div');
    meta.className = 'feedback-meta';
    const type = document.createElement('span');
    type.textContent = item.type || 'writing';
    const severity = document.createElement('small');
    severity.textContent = item.severity || 'low';
    meta.append(type, severity);
    const text = document.createElement('b');
    text.textContent = item.text || '';
    const actions = document.createElement('div');
    actions.className = 'feedback-actions';
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'feedback-toggle';
    toggle.textContent = uiText('feedback.expand');
    toggle.setAttribute('aria-expanded', 'false');
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'feedback-remove';
    remove.textContent = '×';
    remove.setAttribute('aria-label', uiText('feedback.delete'));
    actions.append(toggle, remove);
    head.append(meta, actions);
    const solution = document.createElement('div');
    solution.className = 'feedback-solution';
    solution.hidden = true;
    const solutionLabel = document.createElement('strong');
    solutionLabel.textContent = uiText('feedback.solution');
    const suggestion = document.createElement('p');
    suggestion.textContent = item.suggestion || uiText('feedback.noSolution');
    solution.append(solutionLabel, suggestion);
    toggle.onclick = () => {
      const expanded = solution.hidden;
      solution.hidden = !expanded;
      article.classList.toggle('expanded', expanded);
      toggle.textContent = expanded ? uiText('feedback.collapse') : uiText('feedback.expand');
      toggle.setAttribute('aria-expanded', String(expanded));
    };
    remove.onclick = () => {
      article.classList.add('removing');
      article.addEventListener('transitionend', event => {
        if (event.target !== article) return;
        article.remove();
        if (!els.feedbackList.querySelector('.feedback-item')) {
          els.feedbackList.replaceChildren(Object.assign(document.createElement('p'), { textContent: uiText('assist.feedbackEmpty') }));
        }
      }, { once: true });
    };
    article.append(head, text, solution);
    return article;
  }));
}

export async function analyzeFeedback() {
  saveCurrentFile();
  const file = state.projectFiles.get(state.currentPath);
  if (!file || file.kind !== 'text') {
    showToast(uiText('toast.openEditableFirst'));
    return;
  }
  els.feedbackButton.disabled = true;
  els.feedbackButton.textContent = uiText('assist.analyzing');
  els.feedbackList.innerHTML = `<p>${uiText('assist.feedbackLoading')}</p>`;
  try {
    const selection = state.selectedRange && els.editor.value.slice(state.selectedRange.start, state.selectedRange.end) === state.selectedRange.text ? state.selectedRange.text : '';
    const response = await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: state.currentPath,
        content: els.editor.value,
        selection,
        selection_start: state.selectedRange?.start || els.editor.selectionStart || 0,
        selection_end: state.selectedRange?.end || els.editor.selectionEnd || 0,
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || uiText('toast.feedbackFailed'));
    renderFeedback(data);
    showToast(data.demo ? uiText('toast.feedbackDemo') : uiText('toast.feedbackUpdated'));
  } catch (error) {
    els.feedbackList.innerHTML = `<p>${uiText('assist.feedbackFailed')}</p>`;
    showToast(error.message);
  } finally {
    els.feedbackButton.disabled = false;
    els.feedbackButton.textContent = uiText('assist.analyzeFile');
  }
}
