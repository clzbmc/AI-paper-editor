import { saveCurrentFile, scheduleAutoSave, updateEditorMeta } from './editor.js?v=20260625-memory-collapse';
import { findMainTexPath } from './compile.js?v=20260625-memory-collapse';
import { retrieveProjectMemory } from './project_memory.js?v=20260625-memory-collapse';
import { els, showToast, state } from './state.js?v=20260625-memory-collapse';
import { uiText } from './ui_language.js?v=20260625-memory-collapse';

export function collectChatContext() {
  saveCurrentFile();
  const textFiles = [];
  const manifest = [];
  const current = state.currentPath;
  const main = findMainTexPath();
  const priority = path => (path === current ? 0 : path === main ? 1 : /\.bib$/i.test(path) ? 2 : /\.(tex|latex)$/i.test(path) ? 3 : 4);
  const sorted = [...state.projectFiles.values()].sort((a, b) => priority(a.path) - priority(b.path) || a.path.localeCompare(b.path));
  let total = 0;
  let truncated = false;
  const maxTotal = 180000;
  const maxFull = 24000;
  for (const file of sorted) {
    if (file.kind === 'text') {
      const content = String(file.content || '');
      let item = { path: file.path, kind: 'text', content };
      if (total + content.length > maxTotal || content.length > maxFull) {
        const keep = Math.min(content.length, Math.max(2000, maxTotal - total));
        item = { path: file.path, kind: 'text', content: content.slice(0, keep), truncated: true, original_length: content.length };
        truncated = true;
      }
      if (total < maxTotal) {
        textFiles.push(item);
        total += item.content.length;
      } else {
        truncated = true;
        manifest.push({ path: file.path, kind: file.kind, omitted: true, size: content.length });
      }
    } else {
      manifest.push({ path: file.path, kind: file.kind, mime: file.mime || '', size: file.size || file.blob?.size || 0 });
    }
  }
  els.chatContextEl.textContent = uiText('chat.contextSummary', {
    textCount: textFiles.length,
    resourceCount: manifest.length,
    status: truncated ? uiText('chat.contextTruncated') : uiText('chat.contextComplete'),
  });
  return { files: textFiles, resource_manifest: manifest, context_truncated: truncated };
}

export function appendChatMessage(role, content) {
  if (els.chatMessagesEl.querySelector('.chat-empty')) els.chatMessagesEl.replaceChildren();
  const bubble = document.createElement('article');
  bubble.className = `chat-message ${role}`;
  const label = document.createElement('b');
  label.textContent = role === 'user' ? uiText('chat.you') : 'PaperCraft AI';
  const body = document.createElement('p');
  body.textContent = content;
  bubble.append(label, body);
  els.chatMessagesEl.append(bubble);
  els.chatMessagesEl.scrollTop = els.chatMessagesEl.scrollHeight;
}

export function renderChatChanges(changes = []) {
  state.pendingChatChanges = changes;
  els.chatChangesEl.hidden = !changes.length;
  els.chatChangesEl.replaceChildren();
  if (!changes.length) return;
  const title = document.createElement('div');
  title.className = 'chat-changes-title';
  title.textContent = uiText('chat.changesTitle', { count: changes.length });
  els.chatChangesEl.append(title);
  changes.forEach((change, index) => {
    const card = document.createElement('article');
    card.className = 'chat-change';
    const head = document.createElement('b');
    head.textContent = change.path || uiText('chat.unknownFile');
    const reason = document.createElement('p');
    reason.textContent = change.reason || uiText('chat.noReason');
    const find = document.createElement('pre');
    find.textContent = change.find || '';
    const replace = document.createElement('pre');
    replace.textContent = change.replace || '';
    const apply = document.createElement('button');
    apply.textContent = uiText('chat.applyChange');
    apply.onclick = () => applyChatChange(index);
    card.append(head, reason, find, replace, apply);
    els.chatChangesEl.append(card);
  });
}

export function applyChatChange(index) {
  const change = state.pendingChatChanges[index];
  if (!change?.path || !change.find) { showToast(uiText('toast.incompleteChange')); return; }
  const file = state.projectFiles.get(change.path);
  if (!file || file.kind !== 'text') { showToast(uiText('toast.textFileOnly')); return; }
  if (!file.content.includes(change.find)) { showToast(uiText('toast.sourceChanged')); return; }
  file.content = file.content.replace(change.find, change.replace || '');
  if (state.currentPath === change.path) els.editor.value = file.content;
  saveCurrentFile();
  scheduleAutoSave();
  updateEditorMeta();
  showToast(uiText('toast.changeApplied'));
}

export async function sendChatMessage() {
  const content = els.chatInput.value.trim();
  if (!content) return;
  els.chatInput.value = '';
  state.chatMessages.push({ role: 'user', content });
  appendChatMessage('user', content);
  els.chatSend.disabled = true;
  els.chatSend.textContent = uiText('chat.sending');
  try {
    const context = collectChatContext();
    const projectMemory = await retrieveProjectMemory(content, 'chat', 10);
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: state.chatMessages, current_path: state.currentPath, project_memory: projectMemory, ...context }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || uiText('toast.chatFailed'));
    const reply = data.reply || uiText('toast.chatReceived');
    state.chatMessages.push({ role: 'assistant', content: reply });
    appendChatMessage('assistant', reply);
    renderChatChanges(data.changes || []);
    if (data.demo) showToast(uiText('toast.chatDemo'));
  } catch (error) {
    appendChatMessage('assistant', uiText('toast.requestFailed', { message: error.message }));
    showToast(error.message);
  } finally {
    els.chatSend.disabled = false;
    els.chatSend.textContent = uiText('chat.send');
  }
}
