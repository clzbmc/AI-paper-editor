import { scheduleAutoSave, updateEditorMeta } from './editor.js?v=20260625-draft-generator';
import { els, showToast, state } from './state.js?v=20260625-draft-generator';
import { uiText } from './ui_language.js?v=20260625-draft-generator';

let latestDraftText = '';

function setDraftResult(data) {
  latestDraftText = data.text || '';
  els.draftResult.hidden = false;
  els.draftOutput.textContent = latestDraftText;
  els.draftReason.textContent = data.reason || '';
  els.draftStatus.textContent = data.demo ? uiText('draft.demo') : uiText('draft.done');
  els.draftCopy.disabled = !latestDraftText;
  els.draftInsert.disabled = !latestDraftText;
}

export async function generateDraft() {
  const draft = els.draftInput.value.trim();
  if (!draft) {
    showToast(uiText('toast.draftRequired'));
    els.draftInput.focus();
    return;
  }
  const cursorPosition = els.editor.selectionStart || 0;
  els.draftGenerate.disabled = true;
  els.draftGenerate.textContent = uiText('draft.generating');
  els.draftResult.hidden = false;
  els.draftStatus.textContent = uiText('draft.generating');
  els.draftOutput.textContent = '';
  els.draftReason.textContent = '';
  try {
    const response = await fetch('/api/draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: state.currentPath,
        content: els.editor.value,
        cursor_position: cursorPosition,
        draft,
        mode: state.activeMode,
        custom_prompt: els.writingPrompt.value,
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || uiText('toast.draftFailed'));
    setDraftResult(data);
    showToast(data.demo ? uiText('toast.draftDemo') : uiText('toast.draftDone'));
  } catch (error) {
    els.draftStatus.textContent = uiText('draft.failed');
    showToast(error.message);
  } finally {
    els.draftGenerate.disabled = false;
    els.draftGenerate.textContent = uiText('draft.generate');
  }
}

export async function copyDraft() {
  if (!latestDraftText) return;
  await navigator.clipboard.writeText(latestDraftText);
  showToast(uiText('toast.copied'));
}

export function insertDraftAtCursor() {
  if (!latestDraftText) return;
  els.editor.focus({ preventScroll: true });
  document.execCommand('insertText', false, latestDraftText);
  updateEditorMeta();
  scheduleAutoSave();
  showToast(uiText('toast.draftInserted'));
}
