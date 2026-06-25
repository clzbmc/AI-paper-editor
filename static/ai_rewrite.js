import { clearLockedSelection, getContext, updateEditorMeta } from './editor.js?v=20260625-memory-collapse';
import { retrieveProjectMemory } from './project_memory.js?v=20260625-memory-collapse';
import { DEFAULT_PROMPTS, els, showToast, state } from './state.js?v=20260625-memory-collapse';
import { modeLabel, uiText } from './ui_language.js?v=20260625-memory-collapse';

export function showModePrompt() {
  els.writingPrompt.value = state.customPrompts[state.activeMode] || DEFAULT_PROMPTS[state.activeMode];
  els.promptModeLabel.textContent = modeLabel(state.activeMode);
  if (els.modeSelect) els.modeSelect.value = state.activeMode;
  els.promptCount.textContent = `${els.writingPrompt.value.length} / 4000`;
}

export function saveModePrompt() {
  state.customPrompts[state.activeMode] = els.writingPrompt.value;
  localStorage.setItem('papercraft-prompts', JSON.stringify(state.customPrompts));
  els.promptCount.textContent = `${els.writingPrompt.value.length} / 4000`;
}

export function tokenizeDiff(text) {
  return text.match(/\s+|\\[a-zA-Z@]+\*?|[\p{L}\p{N}_]+|[^\s]/gu) || [];
}

export function calculateWordDiff(original, revised) {
  const before = tokenizeDiff(original);
  const after = tokenizeDiff(revised);
  if (before.length * after.length > 1_500_000) {
    let prefix = 0;
    while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++;
    let suffix = 0;
    while (suffix < before.length - prefix && suffix < after.length - prefix && before.at(-1 - suffix) === after.at(-1 - suffix)) suffix++;
    return [
      { type: 'same', tokens: before.slice(0, prefix) },
      { type: 'removed', tokens: before.slice(prefix, before.length - suffix) },
      { type: 'added', tokens: after.slice(prefix, after.length - suffix) },
      { type: 'same', tokens: suffix ? before.slice(before.length - suffix) : [] },
    ].filter(part => part.tokens.length);
  }
  const rows = Array.from({ length: before.length + 1 }, () => new Uint16Array(after.length + 1));
  for (let i = 1; i <= before.length; i++) {
    for (let j = 1; j <= after.length; j++) {
      rows[i][j] = before[i - 1] === after[j - 1] ? rows[i - 1][j - 1] + 1 : Math.max(rows[i - 1][j], rows[i][j - 1]);
    }
  }
  const operations = [];
  let i = before.length;
  let j = after.length;
  while (i || j) {
    if (i && j && before[i - 1] === after[j - 1]) {
      operations.push({ type: 'same', token: before[--i] }); j--;
    } else if (j && (!i || rows[i][j - 1] >= rows[i - 1][j])) {
      operations.push({ type: 'added', token: after[--j] });
    } else {
      operations.push({ type: 'removed', token: before[--i] });
    }
  }
  operations.reverse();
  return operations.reduce((parts, operation) => {
    const last = parts.at(-1);
    if (last?.type === operation.type) last.tokens.push(operation.token);
    else parts.push({ type: operation.type, tokens: [operation.token] });
    return parts;
  }, []);
}

export function renderWordDiff(container, original, revised) {
  calculateWordDiff(original, revised).forEach(part => {
    const span = document.createElement(part.type === 'removed' ? 'del' : part.type === 'added' ? 'ins' : 'span');
    span.textContent = part.tokens.join('');
    container.append(span);
  });
}

export function renderSuggestions(data, originalText) {
  const labels = {
    A: [uiText('suggestion.safe'), uiText('suggestion.safeSub')],
    B: [uiText('suggestion.academic'), uiText('suggestion.academicSub')],
    C: [uiText('suggestion.concise'), uiText('suggestion.conciseSub')],
  };
  const visibleKeys = { all: ['A','B','C'], safe: ['A'], academic: ['B'], concise: ['C'] }[state.activeMode] || ['A','B','C'];
  const labelKeys = { A: ['suggestion.safe', 'suggestion.safeSub'], B: ['suggestion.academic', 'suggestion.academicSub'], C: ['suggestion.concise', 'suggestion.conciseSub'] };
  els.results.innerHTML = (data.demo ? `<div class="demo-note" data-i18n="suggestion.demoNote">${uiText('suggestion.demoNote')}</div>` : '') +
    visibleKeys.map(key => `<article class="suggestion" data-version="${key}"><div class="suggestion-head"><span class="badge">${key}</span><b data-i18n="${labelKeys[key][0]}">${labels[key][0]}</b><small data-i18n="${labelKeys[key][1]}">${labels[key][1]}</small></div><pre class="suggestion-text"></pre><div class="suggestion-reason" hidden><b data-i18n="suggestion.reason">${uiText('suggestion.reason')}</b><p></p></div><div class="diff-heading"><b data-i18n="suggestion.diff">${uiText('suggestion.diff')}</b><span><i class="removed-key"></i><span data-i18n="suggestion.removed">${uiText('suggestion.removed')}</span></span><span><i class="added-key"></i><span data-i18n="suggestion.added">${uiText('suggestion.added')}</span></span></div><div class="diff-text"></div><div class="suggestion-actions"><button class="copy" data-i18n="suggestion.copy">${uiText('suggestion.copy')}</button><button class="replace" data-i18n="suggestion.replaceSelection">${uiText('suggestion.replaceSelection')}</button></div></article>`).join('');
  [...els.results.querySelectorAll('.suggestion')].forEach(card => {
    const value = data[card.dataset.version];
    card.querySelector('pre').textContent = value;
    const reason = data.reasons?.[card.dataset.version] || '';
    if (reason) {
      const reasonBox = card.querySelector('.suggestion-reason');
      reasonBox.hidden = false;
      reasonBox.querySelector('p').textContent = reason;
    }
    renderWordDiff(card.querySelector('.diff-text'), originalText, value);
    card.querySelector('.copy').onclick = async () => { await navigator.clipboard.writeText(value); showToast(uiText('toast.copied')); };
    card.querySelector('.replace').onclick = () => replaceSelection(value);
  });
}

export function replaceSelection(value) {
  if (!state.selectedRange || els.editor.value.slice(state.selectedRange.start, state.selectedRange.end) !== state.selectedRange.text) {
    showToast(uiText('toast.selectionChanged')); return;
  }
  els.editor.focus();
  els.editor.setSelectionRange(state.selectedRange.start, state.selectedRange.end);
  document.execCommand('insertText', false, value);
  clearLockedSelection();
  els.resultStatus.textContent = uiText('result.applied'); updateEditorMeta(); showToast(uiText('toast.replacedWithUndo'));
}

export async function rewrite() {
  if (!state.selectedRange || els.editor.value.slice(state.selectedRange.start, state.selectedRange.end) !== state.selectedRange.text) {
    state.selectedRange = null;
    showToast(uiText('toast.selectTextFirst')); els.editor.focus();
    return;
  }
  const context = getContext();
  const originalText = state.selectedRange.text;
  els.rewriteButton.disabled = true; els.rewriteButton.textContent = uiText('assist.rewriting'); els.resultStatus.textContent = uiText('result.thinking');
  try {
    const projectMemory = await retrieveProjectMemory(`${context.before}\n${state.selectedRange.text}\n${context.after}`, 'rewrite', 6);
    const response = await fetch('/api/rewrite', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ text:state.selectedRange.text, context_before:context.before, context_after:context.after, mode:state.activeMode, custom_prompt:els.writingPrompt.value, project_memory: projectMemory }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || uiText('toast.rewriteFailed'));
    renderSuggestions(data, originalText); els.resultStatus.textContent = data.demo ? uiText('result.demo') : uiText('result.done');
  } catch (error) { showToast(error.message); els.resultStatus.textContent = uiText('result.failed'); }
  finally { els.rewriteButton.disabled = false; els.rewriteButton.textContent = uiText('assist.startRewrite'); }
}

export function resetCurrentPrompt() {
  state.customPrompts[state.activeMode] = DEFAULT_PROMPTS[state.activeMode];
  showModePrompt();
  saveModePrompt();
  showToast(uiText('toast.promptReset'));
}
