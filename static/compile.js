import { cacheProject } from './db.js?v=20260625-draft-generator';
import { collectProjectFiles, renderTree, serializeProjectFiles } from './files.js?v=20260625-draft-generator';
import { revealSourceLine } from './latex_nav.js?v=20260625-draft-generator';
import { compiledPdfFile, flushPendingPdfPreview, loadPdfPreview, queuePdfPreview, resolvePdfPreviewUrl, updatePdfActions } from './pdf_preview.js?v=20260625-draft-generator';
import { base64Blob, els, showToast, state } from './state.js?v=20260625-draft-generator';
import { saveCurrentFile } from './editor.js?v=20260625-draft-generator';
import { uiText } from './ui_language.js?v=20260625-draft-generator';

export function findMainTexPath() {
  const paths = [...state.projectFiles.keys()];
  return paths.find(path => /(^|\/)main\.tex$/i.test(path)) || paths.find(path => /\.tex$/i.test(path)) || '';
}

export function showCompileResult(data, ok) {
  const panel = document.querySelector('#compile-panel');
  const summary = document.querySelector('#compile-summary');
  const errors = document.querySelector('#compile-errors');
  panel.hidden = false;
  summary.textContent = ok ? uiText('compile.successSummary', { engine: data.engine, count: data.diagnostics?.length || 0 }) : data.error || uiText('compile.failed');
  errors.replaceChildren();
  (data.diagnostics || []).forEach(diagnostic => {
    const button = document.createElement('button');
    button.className = 'compile-error';
    const location = document.createElement('b'); location.textContent = `${diagnostic.file}:${diagnostic.line}`;
    const message = document.createElement('span'); message.textContent = diagnostic.message;
    button.append(location, message);
    button.onclick = () => { panel.hidden = true; revealSourceLine(diagnostic.file, diagnostic.line); };
    errors.append(button);
  });
  if (!errors.children.length && data.log) {
    const pre = document.createElement('pre'); pre.className = 'suggestion-text'; pre.textContent = data.log; errors.append(pre);
  }
}

export function switchResultView(view) {
  document.querySelectorAll('[data-result-view]').forEach(button => button.classList.toggle('active', button.dataset.resultView === view));
  els.results.hidden = view !== 'ai';
  document.querySelector('#pdf-live-preview').hidden = view !== 'pdf';
  els.chatPanel.hidden = view !== 'chat';
  if (view === 'pdf') requestAnimationFrame(flushPendingPdfPreview);
}

export async function compileProject({ background = false } = {}) {
  if (state.compileRunning) return;
  saveCurrentFile();
  const main = findMainTexPath();
  if (!main) { showToast(uiText('toast.noCompileMain')); return; }
  state.compileRunning = true;
  const button = document.querySelector('#compile-project');
  button.disabled = true; button.textContent = uiText('editor.compiling');
  try {
    const files = await collectProjectFiles(false);
    const response = await fetch('/api/compile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ main, files }) });
    const responseText = await response.text();
    let data;
    try {
      data = JSON.parse(responseText);
    } catch {
      data = { error: response.status === 404 ? uiText('toast.compileInterfaceMissing') : uiText('toast.compileBadResponse', { status: response.status }) };
    }
    if (!response.ok) {
      if (data.code === 'toolchain_missing') {
        document.querySelector('#auto-compile').checked = false;
        localStorage.setItem('papercraft-auto-compile', 'false');
      }
      showCompileResult(data, false);
      throw new Error(data.error || uiText('compile.failed'));
    }
    const blob = compiledPdfFile(data) || base64Blob(data.pdf, 'application/pdf');
    const outputPath = `build/${data.pdf_name}`;
    const previous = state.projectFiles.get(outputPath);
    const previousUrl = previous?.url || '';
    const pdfUrl = URL.createObjectURL(blob);
    state.projectFiles.set(outputPath, { path: outputPath, kind: 'asset', mime: 'application/pdf', blob, url: pdfUrl, generated: true });
    const previewUrl = await resolvePdfPreviewUrl(data.pdf_url, pdfUrl);
    state.currentPdf = { url: previewUrl, downloadUrl: pdfUrl, name: data.pdf_name || 'papercraft.pdf' };
    updatePdfActions();
    if (!background) switchResultView('pdf');
    if (document.querySelector('#pdf-live-preview').hidden) queuePdfPreview(previewUrl, pdfUrl);
    else loadPdfPreview(previewUrl, pdfUrl);
    if (previousUrl && previousUrl !== pdfUrl) URL.revokeObjectURL(previousUrl);
    renderTree(); cacheProject(serializeProjectFiles).catch(() => {});
    if (!background) showToast(uiText('toast.compileSuccess'));
    else showToast(uiText('toast.compileAutoSuccess'));
  } catch (error) {
    showToast(error.message || uiText('compile.failed'));
  } finally {
    state.compileRunning = false; button.disabled = false; button.textContent = uiText('editor.compilePdf');
  }
}

export function scheduleAutoCompile() {
  if (!document.querySelector('#auto-compile').checked) return;
  clearTimeout(state.compileTimer);
  state.compileTimer = setTimeout(() => compileProject({ background: true }), 2200);
}
