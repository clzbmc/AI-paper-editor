import { saveCurrentFile, scheduleAutoSave, updateEditorMeta } from './editor.js';
import { findMainTexPath } from './compile.js';
import { els, showToast, state } from './state.js';

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
  els.chatContextEl.textContent = `${textFiles.length} 个文本文件 · ${manifest.length} 个资源 · ${truncated ? '上下文已截断' : '上下文完整'}`;
  return { files: textFiles, resource_manifest: manifest, context_truncated: truncated };
}

export function appendChatMessage(role, content) {
  if (els.chatMessagesEl.querySelector('.chat-empty')) els.chatMessagesEl.replaceChildren();
  const bubble = document.createElement('article');
  bubble.className = `chat-message ${role}`;
  const label = document.createElement('b');
  label.textContent = role === 'user' ? '你' : 'PaperCraft AI';
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
  title.textContent = `建议修改 ${changes.length} 处，确认后才会写入项目`;
  els.chatChangesEl.append(title);
  changes.forEach((change, index) => {
    const card = document.createElement('article');
    card.className = 'chat-change';
    const head = document.createElement('b');
    head.textContent = change.path || '未知文件';
    const reason = document.createElement('p');
    reason.textContent = change.reason || '无说明';
    const find = document.createElement('pre');
    find.textContent = change.find || '';
    const replace = document.createElement('pre');
    replace.textContent = change.replace || '';
    const apply = document.createElement('button');
    apply.textContent = '应用这处修改';
    apply.onclick = () => applyChatChange(index);
    card.append(head, reason, find, replace, apply);
    els.chatChangesEl.append(card);
  });
}

export function applyChatChange(index) {
  const change = state.pendingChatChanges[index];
  if (!change?.path || !change.find) { showToast('修改建议不完整'); return; }
  const file = state.projectFiles.get(change.path);
  if (!file || file.kind !== 'text') { showToast('只能应用到文本文件'); return; }
  if (!file.content.includes(change.find)) { showToast('原文已变化，请重新生成建议'); return; }
  file.content = file.content.replace(change.find, change.replace || '');
  if (state.currentPath === change.path) els.editor.value = file.content;
  saveCurrentFile();
  scheduleAutoSave();
  updateEditorMeta();
  showToast('已应用修改并进入自动保存');
}

export async function sendChatMessage() {
  const content = els.chatInput.value.trim();
  if (!content) return;
  els.chatInput.value = '';
  state.chatMessages.push({ role: 'user', content });
  appendChatMessage('user', content);
  els.chatSend.disabled = true;
  els.chatSend.textContent = '发送中…';
  try {
    const context = collectChatContext();
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: state.chatMessages, current_path: state.currentPath, ...context }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '项目对话失败');
    const reply = data.reply || '已收到。';
    state.chatMessages.push({ role: 'assistant', content: reply });
    appendChatMessage('assistant', reply);
    renderChatChanges(data.changes || []);
    if (data.demo) showToast('当前为离线演示对话');
  } catch (error) {
    appendChatMessage('assistant', `请求失败：${error.message}`);
    showToast(error.message);
  } finally {
    els.chatSend.disabled = false;
    els.chatSend.textContent = '发送';
  }
}
