import { saveCurrentFile } from './editor.js';
import { els, showToast, state } from './state.js';

export function renderFeedback(data) {
  const items = data.feedback || [];
  if (!items.length) {
    els.feedbackList.replaceChildren(Object.assign(document.createElement('p'), { textContent: '暂未发现明显写作问题。' }));
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
    showToast('请先打开一个可编辑文本文件');
    return;
  }
  els.feedbackButton.disabled = true;
  els.feedbackButton.textContent = '分析中…';
  els.feedbackList.innerHTML = '<p>正在分析当前写作问题…</p>';
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
    if (!response.ok) throw new Error(data.error || '写作反馈失败');
    renderFeedback(data);
    showToast(data.demo ? '已生成演示反馈' : '写作反馈已更新');
  } catch (error) {
    els.feedbackList.innerHTML = '<p>写作反馈生成失败，请稍后重试。</p>';
    showToast(error.message);
  } finally {
    els.feedbackButton.disabled = false;
    els.feedbackButton.textContent = '分析当前文件';
  }
}
