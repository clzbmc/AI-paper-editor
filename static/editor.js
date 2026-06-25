import { cacheProject } from './db.js?v=20260625-memory-collapse';
import { openProjectFile as openProjectFileFromFiles, serializeProjectFiles, writeToSource } from './files.js?v=20260625-memory-collapse';
import { els, showToast, state } from './state.js?v=20260625-memory-collapse';
import { uiText } from './ui_language.js?v=20260625-memory-collapse';

export function refreshLineNumbers(force = false) {
  const computed = getComputedStyle(els.editor);
  const contentWidth = Math.max(40, els.editor.clientWidth - parseFloat(computed.paddingLeft) - parseFloat(computed.paddingRight));
  if (!force && state.lastMeasuredValue === els.editor.value && Math.abs(state.lastMeasuredWidth - contentWidth) < 1) return;
  state.lastMeasuredValue = els.editor.value;
  state.lastMeasuredWidth = contentWidth;
  els.lineMeasure.style.width = `${contentWidth}px`;
  const lines = els.editor.value.split('\n');
  const measureFragment = document.createDocumentFragment();
  lines.forEach(line => {
    const row = document.createElement('div');
    row.textContent = line || '\u200b';
    measureFragment.append(row);
  });
  els.lineMeasure.replaceChildren(measureFragment);
  const numberFragment = document.createDocumentFragment();
  [...els.lineMeasure.children].forEach((row, index) => {
    const number = document.createElement('span');
    number.textContent = index + 1;
    number.style.height = `${row.getBoundingClientRect().height}px`;
    numberFragment.append(number);
  });
  els.lineNumbers.replaceChildren(numberFragment);
  els.lineNumbers.scrollTop = els.editor.scrollTop;
}

export function scheduleLineNumbers(force = false) {
  clearTimeout(state.lineNumberTimer);
  state.lineNumberTimer = setTimeout(() => refreshLineNumbers(force), 90);
}

export function syncSelectionOverlayScroll() {
  const content = els.selectionOverlay?.firstElementChild;
  if (content) content.style.transform = `translate(${-els.editor.scrollLeft}px, ${-els.editor.scrollTop}px)`;
}

export function renderLockedSelection() {
  if (!els.selectionOverlay) return;
  els.selectionOverlay.replaceChildren();
  if (!state.selectedRange) return;
  if (els.editor.value.slice(state.selectedRange.start, state.selectedRange.end) !== state.selectedRange.text) {
    clearLockedSelection();
    return;
  }
  const { start, end } = state.selectedRange;
  const content = document.createElement('div');
  content.className = 'selection-overlay-content';
  content.append(
    document.createTextNode(els.editor.value.slice(0, start)),
    Object.assign(document.createElement('mark'), { textContent: els.editor.value.slice(start, end) }),
    document.createTextNode(els.editor.value.slice(end) || '\u200b'),
  );
  els.selectionOverlay.append(content);
  syncSelectionOverlayScroll();
}

export async function autoSave(path = state.currentPath) {
  saveCurrentFile();
  const file = state.projectFiles.get(path);
  document.querySelector('#save-state').textContent = uiText('app.saveSaving');
  try {
    const [, wroteSource] = await Promise.all([cacheProject(serializeProjectFiles), writeToSource(file)]);
    document.querySelector('#save-state').textContent = wroteSource === 'server' ? uiText('app.saveServer') : wroteSource ? uiText('app.saveSource') : uiText('app.saveAuto');
  } catch (error) {
    document.querySelector('#save-state').textContent = uiText('app.saveFailed');
    showToast(uiText('toast.autoSaveFailed', { message: error.message }));
  }
}

export function scheduleAutoSave() {
  document.querySelector('#save-state').textContent = uiText('app.editing');
  clearTimeout(state.saveTimer);
  const path = state.currentPath;
  state.saveTimer = setTimeout(() => autoSave(path), 600);
}

export function scheduleViewSave() {
  saveCurrentFile();
  clearTimeout(state.viewSaveTimer);
  state.viewSaveTimer = setTimeout(() => {
    cacheProject(serializeProjectFiles).catch(error => showToast(uiText('toast.viewSaveFailed', { message: error.message })));
  }, 350);
}

export function updateFindMatches(reset = false) {
  const query = document.querySelector('#find-text').value;
  state.findMatches = [];
  if (query) {
    const source = els.editor.value.toLocaleLowerCase();
    const needle = query.toLocaleLowerCase();
    let position = 0;
    while ((position = source.indexOf(needle, position)) !== -1) {
      state.findMatches.push({ start: position, end: position + query.length });
      position += Math.max(1, query.length);
    }
  }
  if (reset) state.findIndex = state.findMatches.length ? 0 : -1;
  else if (state.findIndex >= state.findMatches.length) state.findIndex = state.findMatches.length - 1;
  document.querySelector('#find-status').textContent = `${state.findIndex < 0 ? 0 : state.findIndex + 1} / ${state.findMatches.length}`;
}

export function revealFindMatch(index) {
  if (!state.findMatches.length) return;
  state.findIndex = (index + state.findMatches.length) % state.findMatches.length;
  const match = state.findMatches[state.findIndex];
  els.editor.focus({ preventScroll: true });
  els.editor.setSelectionRange(match.start, match.end);
  const line = els.editor.value.slice(0, match.start).split('\n').length - 1;
  els.editor.scrollTop = Math.max(0, line * (parseFloat(getComputedStyle(els.editor).lineHeight) || 22) - els.editor.clientHeight / 3);
  document.querySelector('#find-status').textContent = `${state.findIndex + 1} / ${state.findMatches.length}`;
}

export function showFindBar() {
  document.querySelector('#find-bar').hidden = false;
  const input = document.querySelector('#find-text');
  input.focus(); input.select(); updateFindMatches(true);
}

export function replaceFindMatch() {
  if (state.findIndex < 0 || !state.findMatches[state.findIndex]) return;
  const match = state.findMatches[state.findIndex];
  els.editor.setRangeText(document.querySelector('#replace-text').value, match.start, match.end, 'select');
  els.editor.dispatchEvent(new Event('input', { bubbles: true }));
  updateFindMatches(true); revealFindMatch(0);
}

export function replaceAllMatches() {
  if (!state.findMatches.length) return;
  const replacement = document.querySelector('#replace-text').value;
  const count = state.findMatches.length;
  for (let index = state.findMatches.length - 1; index >= 0; index--) {
    const match = state.findMatches[index];
    els.editor.setRangeText(replacement, match.start, match.end, 'preserve');
  }
  els.editor.dispatchEvent(new Event('input', { bubbles: true }));
  updateFindMatches(true); showToast(uiText('toast.replacedCount', { count }));
}

export function updateEditorMeta() {
  scheduleLineNumbers();
  renderLockedSelection();
  const beforeCursor = els.editor.value.slice(0, els.editor.selectionStart).split('\n');
  els.cursorPosition.textContent = `Ln ${beforeCursor.length}, Col ${beforeCursor.at(-1).length + 1}`;
  els.wordCount.textContent = `${(els.editor.value.match(/[\p{L}\p{N}_-]+/gu) || []).length} words`;
}

export function clearLockedSelection() {
  state.selectedRange = null;
  if (els.selectionOverlay) els.selectionOverlay.replaceChildren();
  els.selectionCount.textContent = uiText('editor.notSelected');
  els.resultStatus.textContent = uiText('result.waiting');
}

export function captureSelection() {
  updateEditorMeta();
  scheduleViewSave();
  if (els.editor.selectionStart === els.editor.selectionEnd) {
    clearLockedSelection();
    return;
  }
  state.selectedRange = {
    start: els.editor.selectionStart,
    end: els.editor.selectionEnd,
    text: els.editor.value.slice(els.editor.selectionStart, els.editor.selectionEnd),
  };
  renderLockedSelection();
  els.selectionCount.textContent = uiText('editor.selectedChars', { count: state.selectedRange.text.length });
  els.resultStatus.textContent = uiText('editor.selectionReady');
}

export function getContext() {
  if (!state.selectedRange) return { before: '', after: '' };
  const before = els.editor.value.slice(0, state.selectedRange.start).split(/\n\s*\n/).slice(-3).join('\n\n');
  const after = els.editor.value.slice(state.selectedRange.end).split(/\n\s*\n/).slice(0, 3).join('\n\n');
  return { before, after };
}

export function saveCurrentFile() {
  const current = state.projectFiles.get(state.currentPath);
  if (current?.kind === 'text') {
    current.content = els.editor.value;
    current.view = {
      scrollTop: els.editor.scrollTop,
      scrollLeft: els.editor.scrollLeft,
      selectionStart: els.editor.selectionStart,
      selectionEnd: els.editor.selectionEnd,
    };
  }
}

export function openProjectFile(path) {
  openProjectFileFromFiles(path);
}
