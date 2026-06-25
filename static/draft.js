import { scheduleAutoSave, updateEditorMeta } from './editor.js?v=20260625-memory-collapse';
import { retrieveProjectMemory } from './project_memory.js?v=20260625-memory-collapse';
import { els, showToast, state } from './state.js?v=20260625-memory-collapse';
import { modeLabel, uiText } from './ui_language.js?v=20260625-memory-collapse';

const DRAFT_VARIANTS = {
  A: ['draft.safe', 'draft.safeSub'],
  B: ['draft.academic', 'draft.academicSub'],
  C: ['draft.concise', 'draft.conciseSub'],
};

function insertTextAtCursor(text) {
  els.editor.focus({ preventScroll: true });
  document.execCommand('insertText', false, text);
  updateEditorMeta();
  scheduleAutoSave();
  showToast(uiText('toast.draftInserted'));
}

function renderDraftCard({ key = '', title, subtitle = '', text = '', reason = '' }) {
  const card = document.createElement('article');
  card.className = 'draft-variant';
  if (key) card.dataset.variant = key;
  card.innerHTML = `
    <div class="draft-variant-head">
      ${key ? `<span class="badge">${key}</span>` : ''}
      <div><b></b>${subtitle ? '<small></small>' : ''}</div>
    </div>
    <textarea class="draft-output-editor" rows="7" spellcheck="false" aria-label="${uiText('draft.outputAria')}"></textarea>
    ${reason ? '<p class="draft-variant-reason"></p>' : ''}
    <div class="draft-actions"><button type="button" class="draft-copy-one">${uiText('draft.copy')}</button><button type="button" class="draft-insert-one">${uiText('draft.insert')}</button></div>
  `;
  card.querySelector('b').textContent = title;
  const small = card.querySelector('small');
  if (small) small.textContent = subtitle;
  const editor = card.querySelector('textarea');
  editor.value = text;
  const reasonBox = card.querySelector('.draft-variant-reason');
  if (reasonBox) reasonBox.textContent = reason;
  card.querySelector('.draft-copy-one').onclick = async () => {
    const value = editor.value.trim();
    if (!value) {
      showToast(uiText('toast.draftEmptyResult'));
      editor.focus();
      return;
    }
    await navigator.clipboard.writeText(value);
    showToast(uiText('toast.copied'));
  };
  card.querySelector('.draft-insert-one').onclick = () => {
    const value = editor.value.trim();
    if (!value) {
      showToast(uiText('toast.draftEmptyResult'));
      editor.focus();
      return;
    }
    insertTextAtCursor(value);
  };
  return card;
}

function setDraftResult(data) {
  els.draftResult.hidden = false;
  els.draftOutput.innerHTML = '';
  if (data.variants) {
    Object.entries(DRAFT_VARIANTS).forEach(([key, labelKeys]) => {
      els.draftOutput.append(renderDraftCard({
        key,
        title: uiText(labelKeys[0]),
        subtitle: uiText(labelKeys[1]),
        text: data.variants[key] || '',
        reason: data.reasons?.[key] || '',
      }));
    });
    els.draftReason.textContent = '';
  } else {
    els.draftOutput.append(renderDraftCard({
      title: modeLabel(state.activeMode),
      text: data.text || '',
      reason: data.reason || '',
    }));
    els.draftReason.textContent = data.reason || '';
  }
  els.draftStatus.textContent = data.demo ? uiText('draft.demo') : uiText('draft.done');
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
  els.draftOutput.innerHTML = '';
  els.draftReason.textContent = '';
  try {
    const projectMemory = await retrieveProjectMemory(draft, 'draft', 6);
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
        project_memory: projectMemory,
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
