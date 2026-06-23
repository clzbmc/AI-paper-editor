import { captureSelection, getContext, updateEditorMeta } from './editor.js';
import { DEFAULT_PROMPTS, MODE_LABELS, els, showToast, state } from './state.js';

export function showModePrompt() {
  els.writingPrompt.value = state.customPrompts[state.activeMode] || DEFAULT_PROMPTS[state.activeMode];
  els.promptModeLabel.textContent = MODE_LABELS[state.activeMode];
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
  const labels = { A: ['保守修订', '语法与清晰度'], B: ['学术强化', '严谨与专业'], C: ['精简表达', '简洁与直接'] };
  const visibleKeys = { all: ['A','B','C'], safe: ['A'], academic: ['B'], concise: ['C'] }[state.activeMode] || ['A','B','C'];
  els.results.innerHTML = (data.demo ? '<div class="demo-note">当前为离线演示模式。请在 model_config.json 中配置并启用模型。</div>' : '') +
    visibleKeys.map(key => `<article class="suggestion" data-version="${key}"><div class="suggestion-head"><span class="badge">${key}</span><b>${labels[key][0]}</b><small>${labels[key][1]}</small></div><pre class="suggestion-text"></pre><div class="suggestion-reason" hidden><b>修改理由</b><p></p></div><div class="diff-heading"><b>逐词 Diff</b><span><i class="removed-key"></i>删除</span><span><i class="added-key"></i>新增</span></div><div class="diff-text"></div><div class="suggestion-actions"><button class="copy">复制</button><button class="replace">替换选区</button></div></article>`).join('');
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
    card.querySelector('.copy').onclick = async () => { await navigator.clipboard.writeText(value); showToast('已复制'); };
    card.querySelector('.replace').onclick = () => replaceSelection(value);
  });
}

export function replaceSelection(value) {
  if (!state.selectedRange || els.editor.value.slice(state.selectedRange.start, state.selectedRange.end) !== state.selectedRange.text) {
    showToast('原选区已变化，请重新选择'); return;
  }
  els.editor.focus();
  els.editor.setSelectionRange(state.selectedRange.start, state.selectedRange.end);
  document.execCommand('insertText', false, value);
  state.selectedRange = null;
  els.selectionCount.textContent = '未选择文本';
  els.resultStatus.textContent = '已应用'; updateEditorMeta(); showToast('已替换并保留撤销记录');
}

export async function rewrite() {
  if (!state.selectedRange || els.editor.value.slice(state.selectedRange.start, state.selectedRange.end) !== state.selectedRange.text) {
    state.selectedRange = null;
    showToast('请先在编辑器中选中一段文本'); els.editor.focus();
    return;
  }
  const context = getContext();
  const originalText = state.selectedRange.text;
  els.rewriteButton.disabled = true; els.rewriteButton.textContent = '正在润色…'; els.resultStatus.textContent = 'AI 正在思考';
  try {
    const response = await fetch('/api/rewrite', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ text:state.selectedRange.text, context_before:context.before, context_after:context.after, mode:state.activeMode, custom_prompt:els.writingPrompt.value }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '润色失败');
    renderSuggestions(data, originalText); els.resultStatus.textContent = data.demo ? '演示结果' : '生成完成';
  } catch (error) { showToast(error.message); els.resultStatus.textContent = '请求失败'; }
  finally { els.rewriteButton.disabled = false; els.rewriteButton.textContent = '✦ 开始润色'; }
}

export function resetCurrentPrompt() {
  state.customPrompts[state.activeMode] = DEFAULT_PROMPTS[state.activeMode];
  showModePrompt();
  saveModePrompt();
  showToast('已恢复当前目标的默认提示词');
}
