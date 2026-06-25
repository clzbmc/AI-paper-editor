import { resetCurrentPrompt, rewrite, saveModePrompt, showModePrompt } from './ai_rewrite.js?v=20260625-codemirror-editor';
import { sendChatMessage } from './chat.js?v=20260625-codemirror-editor';
import { initCodeEditor, onEditorChange, onEditorScroll, onEditorSelectionChange, redoEdit, undoEdit } from './code_editor.js?v=20260625-codemirror-editor';
import { compileProject, scheduleAutoCompile, switchResultView } from './compile.js?v=20260625-codemirror-editor';
import { generateDraft } from './draft.js?v=20260625-codemirror-editor';
import {
  captureSelection,
  clearLockedSelection,
  replaceAllMatches,
  replaceFindMatch,
  revealFindMatch,
  clearSearchHighlights,
  scheduleAutoSave,
  scheduleViewSave,
  showFindBar,
  updateEditorMeta,
  updateFindMatches,
  focusSourceEditor,
} from './editor.js?v=20260625-codemirror-editor';
import { analyzeFeedback } from './feedback.js?v=20260625-codemirror-editor';
import {
  createProjectFromZip,
  exportProject,
  initDefaultProject,
  openSingleFile,
  openFiles,
  openProjectFolder,
  restoreProject,
} from './files.js?v=20260625-codemirror-editor';
import { navigateLatexReference } from './latex_nav.js?v=20260625-codemirror-editor';
import { applyLayout, setupResizableLayout } from './layout.js?v=20260625-codemirror-editor';
import { downloadCurrentPdf, openCurrentPdfFullscreen } from './pdf_preview.js?v=20260625-codemirror-editor';
import { buildProjectMemory, confirmProjectMemory, markProjectMemoryStale, renderProjectMemory, toggleProjectMemory } from './project_memory.js?v=20260625-codemirror-editor';
import { els, showToast, state } from './state.js?v=20260625-codemirror-editor';
import { applyUiLanguage, toggleUiLanguage, uiText } from './ui_language.js?v=20260625-codemirror-editor';

function bindEditorEvents() {
  els.editor.addEventListener('pointerdown', () => { if (state.selectedRange) clearLockedSelection(); });
  els.editor.addEventListener('dblclick', () => requestAnimationFrame(navigateLatexReference));
  els.editor.addEventListener('click', event => { if (event.metaKey || event.ctrlKey) requestAnimationFrame(navigateLatexReference); });
  onEditorSelectionChange(captureSelection);
  onEditorChange(() => { updateEditorMeta(); updateFindMatches(false); scheduleAutoSave(); scheduleAutoCompile(); markProjectMemoryStale(); });
  onEditorScroll(scheduleViewSave);
}

function bindToolbarEvents() {
  els.modeSelect.onchange = () => { saveModePrompt(); state.activeMode = els.modeSelect.value; showModePrompt(); };
  els.writingPrompt.addEventListener('input', saveModePrompt);
  document.querySelector('#reset-prompt').onclick = resetCurrentPrompt;
  els.feedbackButton.onclick = analyzeFeedback;
  els.chatSend.onclick = sendChatMessage;
  els.draftGenerate.onclick = generateDraft;
  els.memoryRefresh.onclick = () => buildProjectMemory(true);
  els.memoryConfirm.onclick = confirmProjectMemory;
  els.memoryToggle.onclick = toggleProjectMemory;
  els.draftInput.addEventListener('keydown', event => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); generateDraft(); } });
  els.pdfDownloadButton.onclick = downloadCurrentPdf;
  els.pdfFullscreenButton.onclick = openCurrentPdfFullscreen;
  els.chatInput.addEventListener('keydown', event => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); sendChatMessage(); } });
  document.querySelector('#find-toggle').onclick = showFindBar;
  document.querySelector('#find-close').onclick = () => {
    document.querySelector('#find-bar').hidden = true;
    document.querySelector('#find-text').value = '';
    clearSearchHighlights();
    focusSourceEditor();
  };
  document.querySelector('#find-text').addEventListener('input', () => updateFindMatches(true));
  document.querySelector('#find-text').addEventListener('keydown', event => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const step = event.shiftKey ? -1 : 1;
    revealFindMatch(state.findHasNavigated ? state.findIndex + step : state.findIndex);
  });
  document.querySelector('#find-next').onclick = () => revealFindMatch(state.findIndex + 1);
  document.querySelector('#find-prev').onclick = () => revealFindMatch(state.findIndex - 1);
  document.querySelector('#replace-one').onclick = replaceFindMatch;
  document.querySelector('#replace-all').onclick = replaceAllMatches;
  document.querySelector('#undo').onclick = undoEdit;
  document.querySelector('#redo').onclick = redoEdit;
  document.querySelector('#open-file').onclick = () => els.fileInput.click();
  document.querySelector('#create-project-from-zip').onclick = () => els.zipProjectInput.click();
  document.querySelector('#open-folder').onclick = openProjectFolder;
  document.querySelector('#export-project').onclick = exportProject;
  els.languageToggle.onclick = () => {
    toggleUiLanguage();
    showModePrompt();
    renderProjectMemory();
    if (!state.selectedRange) {
      els.selectionCount.textContent = state.projectFiles.get(state.currentPath)?.kind === 'text' ? uiText('editor.notSelected') : uiText('editor.resourcePreview');
      els.resultStatus.textContent = uiText('result.waiting');
    }
    if (!state.currentPdf?.url) document.querySelector('#pdf-placeholder').textContent = uiText('pdf.placeholder');
  };
  document.querySelector('#compile-project').onclick = () => compileProject();
  document.querySelector('#compile-close').onclick = () => { document.querySelector('#compile-panel').hidden = true; };
  document.querySelector('#auto-compile').checked = localStorage.getItem('papercraft-auto-compile') === 'true';
  document.querySelector('#auto-compile').onchange = event => localStorage.setItem('papercraft-auto-compile', String(event.target.checked));
  document.querySelectorAll('[data-result-view]').forEach(button => button.onclick = () => switchResultView(button.dataset.resultView));
}

function bindFileEvents() {
  els.fileInput.onchange = () => {
    const file = els.fileInput.files[0];
    openSingleFile(file);
    els.fileInput.value = '';
  };
  els.zipProjectInput.onchange = () => {
    const file = els.zipProjectInput.files[0];
    if (file) createProjectFromZip(file);
    els.zipProjectInput.value = '';
  };
  els.folderInput.onchange = () => { openFiles(els.folderInput.files); els.folderInput.value = ''; };
  ['dragenter', 'dragover'].forEach(type => els.editorShell.addEventListener(type, event => { event.preventDefault(); els.editorShell.classList.add('dragging'); }));
  ['dragleave', 'drop'].forEach(type => els.editorShell.addEventListener(type, event => { event.preventDefault(); els.editorShell.classList.remove('dragging'); }));
  els.editorShell.addEventListener('drop', event => {
    const files = event.dataTransfer.files;
    if (files[0]?.name.toLowerCase().endsWith('.zip')) {
      event.preventDefault();
      showToast(uiText('toast.zipUseCreateProject'));
      return;
    }
    files.length === 1 ? openSingleFile(files[0]) : openFiles(files);
  });
}

function bindGlobalShortcuts() {
  document.querySelector('#polish-top').onclick = rewrite;
  els.rewriteButton.onclick = rewrite;
  document.addEventListener('keydown', event => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); rewrite(); }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') { event.preventDefault(); showFindBar(); }
    if (event.key === 'Escape' && !document.querySelector('#find-bar').hidden) { document.querySelector('#find-bar').hidden = true; focusSourceEditor(); }
  });
}

function init() {
  applyUiLanguage();
  initCodeEditor();
  bindEditorEvents();
  bindToolbarEvents();
  bindFileEvents();
  bindGlobalShortcuts();
  initDefaultProject();
  updateEditorMeta();
  restoreProject();
  renderProjectMemory();
  setTimeout(() => buildProjectMemory(false), 400);
  setupResizableLayout();
  showModePrompt();
  new ResizeObserver(() => updateFindMatches(false)).observe(els.editor);
  window.addEventListener('papercraft-project-loaded', () => buildProjectMemory(false));
  window.addEventListener('papercraft-memory-saved', scheduleAutoSave);
  window.addEventListener('resize', () => { applyLayout(); updateFindMatches(false); });
}

init();
