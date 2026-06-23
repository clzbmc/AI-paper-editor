import { resetCurrentPrompt, rewrite, saveModePrompt, showModePrompt } from './ai_rewrite.js';
import { sendChatMessage } from './chat.js';
import { compileProject, scheduleAutoCompile, switchResultView } from './compile.js';
import {
  captureSelection,
  clearLockedSelection,
  replaceAllMatches,
  replaceFindMatch,
  revealFindMatch,
  scheduleAutoSave,
  scheduleLineNumbers,
  scheduleViewSave,
  showFindBar,
  updateEditorMeta,
  updateFindMatches,
} from './editor.js';
import { analyzeFeedback } from './feedback.js';
import {
  createProjectFromZip,
  exportProject,
  initDefaultProject,
  openSingleFile,
  openFiles,
  openProjectFolder,
  restoreProject,
} from './files.js';
import { navigateLatexReference } from './latex_nav.js';
import { applyLayout, setupResizableLayout } from './layout.js';
import { downloadCurrentPdf, openCurrentPdfFullscreen } from './pdf_preview.js';
import { els, showToast, state } from './state.js';
import { applyUiLanguage, toggleUiLanguage, uiText } from './ui_language.js';

function bindEditorEvents() {
  els.editor.addEventListener('pointerdown', () => {
    if (!state.selectedRange) return;
    const collapsePosition = els.editor.selectionEnd;
    clearLockedSelection();
    els.editor.setSelectionRange(collapsePosition, collapsePosition);
  });
  els.editor.addEventListener('dblclick', navigateLatexReference);
  els.editor.addEventListener('click', event => { if (event.metaKey || event.ctrlKey) navigateLatexReference(); });
  els.editor.addEventListener('select', captureSelection);
  els.editor.addEventListener('click', captureSelection);
  els.editor.addEventListener('keyup', captureSelection);
  els.editor.addEventListener('input', () => { updateEditorMeta(); scheduleAutoSave(); scheduleAutoCompile(); });
  els.editor.addEventListener('scroll', () => { els.lineNumbers.scrollTop = els.editor.scrollTop; scheduleViewSave(); });
  els.lineNumbers.addEventListener('wheel', event => {
    event.preventDefault();
    els.editor.scrollBy({ top: event.deltaY, left: event.deltaX });
  }, { passive: false });
}

function bindToolbarEvents() {
  els.modeSelect.onchange = () => { saveModePrompt(); state.activeMode = els.modeSelect.value; showModePrompt(); };
  els.writingPrompt.addEventListener('input', saveModePrompt);
  document.querySelector('#reset-prompt').onclick = resetCurrentPrompt;
  els.feedbackButton.onclick = analyzeFeedback;
  els.chatSend.onclick = sendChatMessage;
  els.pdfDownloadButton.onclick = downloadCurrentPdf;
  els.pdfFullscreenButton.onclick = openCurrentPdfFullscreen;
  els.chatInput.addEventListener('keydown', event => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); sendChatMessage(); } });
  document.querySelector('#find-toggle').onclick = showFindBar;
  document.querySelector('#find-close').onclick = () => { document.querySelector('#find-bar').hidden = true; els.editor.focus(); };
  document.querySelector('#find-text').addEventListener('input', () => { updateFindMatches(true); revealFindMatch(0); });
  document.querySelector('#find-next').onclick = () => revealFindMatch(state.findIndex + 1);
  document.querySelector('#find-prev').onclick = () => revealFindMatch(state.findIndex - 1);
  document.querySelector('#replace-one').onclick = replaceFindMatch;
  document.querySelector('#replace-all').onclick = replaceAllMatches;
  document.addEventListener('pointerdown', event => {
    if (!state.selectedRange || event.target === els.editor) return;
    if (event.target.closest('button')) event.preventDefault();
  });
  document.querySelector('#undo').onclick = () => { els.editor.focus(); document.execCommand('undo'); };
  document.querySelector('#redo').onclick = () => { els.editor.focus(); document.execCommand('redo'); };
  document.querySelector('#open-file').onclick = () => els.fileInput.click();
  document.querySelector('#create-project-from-zip').onclick = () => els.zipProjectInput.click();
  document.querySelector('#open-folder').onclick = openProjectFolder;
  document.querySelector('#export-project').onclick = exportProject;
  els.languageToggle.onclick = () => {
    toggleUiLanguage();
    showModePrompt();
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
    if (event.key === 'Escape' && !document.querySelector('#find-bar').hidden) { document.querySelector('#find-bar').hidden = true; els.editor.focus(); }
  });
}

function init() {
  applyUiLanguage();
  bindEditorEvents();
  bindToolbarEvents();
  bindFileEvents();
  bindGlobalShortcuts();
  initDefaultProject();
  updateEditorMeta();
  restoreProject();
  setupResizableLayout();
  showModePrompt();
  new ResizeObserver(() => scheduleLineNumbers(true)).observe(els.editor);
  window.addEventListener('resize', () => { applyLayout(); scheduleLineNumbers(true); });
}

init();
