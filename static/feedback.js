import { saveCurrentFile } from './editor.js';
import { els, showToast, state } from './state.js';
import { uiText } from './ui_language.js';

export function renderFeedback(data) {
  const items = data.feedback || [];
  if (!items.length) {
    els.feedbackList.replaceChildren(Object.assign(document.createElement('p'), { textContent: uiText('assist.feedbackEmpty') }));
    return;
  }
  els.feedbackList.replaceChildren(...items.map(item => {
    const article = document.createElement('article');
    article.className = `feedback-item ${item.severity || 'low'}`;
    const type = document.createElement('span');
    type.textContent = item.type || 'writing';
    const text = document.createElement('b');
    text.textContent = item.text || '';
    const suggestion = document.createElement('p');
    suggestion.textContent = item.suggestion || '';
    article.append(type, text, suggestion);
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
