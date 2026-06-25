import { cacheProject } from './db.js?v=20260625-codemirror-editor';
import {
  focusEditor,
  getCursorPosition,
  getLineColumn,
  getRangeText,
  getScrollState,
  getSelection,
  getValue,
  replaceRange,
  replaceRanges,
  revealRange,
  setSelection,
} from './code_editor.js?v=20260625-codemirror-editor';
import { openProjectFile as openProjectFileFromFiles, serializeProjectFiles, writeToSource } from './files.js?v=20260625-codemirror-editor';
import { els, showToast, state } from './state.js?v=20260625-codemirror-editor';
import { uiText } from './ui_language.js?v=20260625-codemirror-editor';

export function refreshLineNumbers() {}

export function scheduleLineNumbers() {}

export function syncSelectionOverlayScroll() {}

export function syncSearchOverlayScroll() {}

export function renderLockedSelection() {}

export function renderSearchHighlights() {}

export function clearSearchHighlights() {
  state.findMatches = [];
  state.findIndex = -1;
  const status = document.querySelector('#find-status');
  if (status) status.textContent = '0 / 0';
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
  const sourceText = getValue();
  state.findMatches = [];
  if (query) {
    const source = sourceText.toLocaleLowerCase();
    const needle = query.toLocaleLowerCase();
    let position = 0;
    while ((position = source.indexOf(needle, position)) !== -1) {
      state.findMatches.push({ start: position, end: position + query.length });
      position += Math.max(1, query.length);
    }
  }
  if (reset) state.findIndex = state.findMatches.length ? 0 : -1;
  else if (state.findIndex >= state.findMatches.length) state.findIndex = state.findMatches.length - 1;
  if (reset) state.findHasNavigated = false;
  document.querySelector('#find-status').textContent = `${state.findIndex < 0 ? 0 : state.findIndex + 1} / ${state.findMatches.length}`;
}

export function revealFindMatch(index) {
  if (!state.findMatches.length) return;
  state.findIndex = (index + state.findMatches.length) % state.findMatches.length;
  state.findHasNavigated = true;
  const match = state.findMatches[state.findIndex];
  revealRange(match.start, match.end);
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
  replaceRange(match.start, match.end, document.querySelector('#replace-text').value);
  updateFindMatches(true);
  if (state.findMatches.length) revealFindMatch(Math.min(state.findIndex, state.findMatches.length - 1));
}

export function replaceAllMatches() {
  if (!state.findMatches.length) return;
  const replacement = document.querySelector('#replace-text').value;
  const count = state.findMatches.length;
  replaceRanges(state.findMatches, replacement);
  updateFindMatches(true);
  showToast(uiText('toast.replacedCount', { count }));
}

export function updateEditorMeta() {
  const { line, column } = getLineColumn(getCursorPosition());
  els.cursorPosition.textContent = `Ln ${line}, Col ${column}`;
  els.wordCount.textContent = `${(getValue().match(/[\p{L}\p{N}_-]+/gu) || []).length} words`;
}

export function clearLockedSelection() {
  state.selectedRange = null;
  els.selectionCount.textContent = uiText('editor.notSelected');
  els.resultStatus.textContent = uiText('result.waiting');
}

export function captureSelection() {
  updateEditorMeta();
  scheduleViewSave();
  const selection = getSelection();
  if (selection.start === selection.end) {
    clearLockedSelection();
    return;
  }
  state.selectedRange = {
    start: selection.start,
    end: selection.end,
    text: selection.text,
  };
  els.selectionCount.textContent = uiText('editor.selectedChars', { count: state.selectedRange.text.length });
  els.resultStatus.textContent = uiText('editor.selectionReady');
}

export function getContext() {
  if (!state.selectedRange) return { before: '', after: '' };
  const content = getValue();
  const before = content.slice(0, state.selectedRange.start).split(/\n\s*\n/).slice(-3).join('\n\n');
  const after = content.slice(state.selectedRange.end).split(/\n\s*\n/).slice(0, 3).join('\n\n');
  return { before, after };
}

export function saveCurrentFile() {
  const current = state.projectFiles.get(state.currentPath);
  if (current?.kind === 'text') {
    current.content = getValue();
    current.view = getScrollState();
  }
}

export function selectionStillMatches() {
  return Boolean(state.selectedRange && getRangeText(state.selectedRange.start, state.selectedRange.end) === state.selectedRange.text);
}

export function restoreSelection(start, end) {
  setSelection(start, end);
}

export function focusSourceEditor(options = {}) {
  focusEditor(options);
}

export function openProjectFile(path) {
  openProjectFileFromFiles(path);
}
