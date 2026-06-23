import { getCachedProject, cacheProject } from './db.js';
import { saveCurrentFile, updateEditorMeta, captureSelection, autoSave } from './editor.js';
import { resetPdfPreview } from './pdf_preview.js';
import { base64Blob, bufferToBase64, els, showToast, state } from './state.js';

export async function writeToSource(file) {
  if (!file || file.kind !== 'text') return false;
  if (file.handle) {
    const permission = await file.handle.queryPermission({ mode: 'readwrite' });
    if (permission === 'granted') {
      const writable = await file.handle.createWritable();
      await writable.write(file.content);
      await writable.close();
      return 'source';
    }
  }
  if (file.serverRootId && file.serverWritable) {
    const response = await fetch('/api/save-project-file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root_id: file.serverRootId, path: file.path, content: file.content }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '项目文件夹写回失败');
    return 'server';
  }
  return false;
}

export function friendlyFileError(error, path) {
  const message = String(error?.message || error || '');
  if (/object can ?not be found here/i.test(message) || error?.name === 'NotFoundError') {
    return `资源缓存已失效：${path}。请重新打开一次项目文件夹以重建缓存。`;
  }
  return `${path} 读取失败：${message || '未知错误'}`;
}

export function hydrateProjectFile(file) {
  if (file?.kind === 'asset' && file.encoding === 'base64' && typeof file.content === 'string') {
    const blob = base64Blob(file.content, file.mime || 'application/octet-stream');
    const { content, encoding, url, ...asset } = file;
    return { ...asset, blob, size: file.size || blob.size };
  }
  return file;
}

export function parsedProjectFile(item) {
  if (item.kind === 'text') return item;
  const blob = base64Blob(item.content, item.mime || 'application/octet-stream');
  const { content, encoding, ...asset } = item;
  return { ...asset, blob };
}

export function fileKind(path) {
  if (/\.(tex|latex|bib|sty|cls|bst|rtx|txt|text|md)$/i.test(path)) return 'text';
  if (/\.(pdf|png|jpe?g|gif|svg|webp)$/i.test(path)) return 'asset';
  return 'other';
}

export function fileIcon(path) {
  if (/\.tex$/i.test(path)) return 'T';
  if (/\.bib$/i.test(path)) return 'B';
  if (/\.pdf$/i.test(path)) return 'P';
  if (/\.(png|jpe?g|gif|svg|webp)$/i.test(path)) return '▧';
  return '·';
}

export function renderTree() {
  els.treeFiles.innerHTML = '';
  [...state.projectFiles.keys()].sort((a, b) => a.localeCompare(b)).forEach(path => {
    const button = document.createElement('button');
    button.className = `tree-file${path === state.currentPath ? ' active' : ''}`;
    button.dataset.path = path;
    button.title = path;
    button.style.paddingLeft = `${7 + Math.min(path.split('/').length - 1, 4) * 10}px`;
    const icon = document.createElement('span'); icon.textContent = fileIcon(path);
    button.append(icon, document.createTextNode(path.split('/').at(-1)));
    button.onclick = () => openProjectFile(path);
    els.treeFiles.append(button);
  });
}

export function openProjectFile(path) {
  const previousPath = state.currentPath;
  saveCurrentFile();
  if (previousPath && previousPath !== path) autoSave(previousPath);
  const file = state.projectFiles.get(path);
  if (!file) return;
  state.currentPath = path;
  document.querySelector('#document-title').value = path.split('/').at(-1);
  state.selectedRange = null;
  els.filePreview.replaceChildren();
  if (file.kind === 'text') {
    els.editor.hidden = false; els.lineNumbers.hidden = false; els.filePreview.hidden = true;
    els.editor.value = file.content;
    const view = file.view || {};
    const selectionStart = Math.min(view.selectionStart ?? 0, els.editor.value.length);
    const selectionEnd = Math.min(view.selectionEnd ?? selectionStart, els.editor.value.length);
    els.editor.focus({ preventScroll: true });
    els.editor.setSelectionRange(selectionStart, selectionEnd);
    updateEditorMeta();
    requestAnimationFrame(() => {
      els.editor.scrollTop = view.scrollTop ?? 0;
      els.editor.scrollLeft = view.scrollLeft ?? 0;
      els.lineNumbers.scrollTop = els.editor.scrollTop;
    });
  } else {
    els.editor.hidden = true; els.lineNumbers.hidden = true; els.filePreview.hidden = false;
    if (file.kind === 'asset' && /^image\//.test(file.mime)) {
      const image = document.createElement('img'); image.src = file.url; image.alt = path; els.filePreview.append(image);
    } else if (file.kind === 'asset' && file.mime === 'application/pdf') {
      const frame = document.createElement('iframe'); frame.src = file.url; frame.title = path; els.filePreview.append(frame);
    } else {
      const message = document.createElement('div'); message.className = 'unsupported'; message.textContent = '该文件已纳入项目，但暂不支持预览。'; els.filePreview.append(message);
    }
  }
  els.selectionCount.textContent = file.kind === 'text' ? '未选择文本' : '资源预览';
  renderTree();
}

export function loadProject(files, name, preferredPath = '', persist = true) {
  saveCurrentFile();
  resetPdfPreview();
  state.projectFiles.forEach(file => { if (file.url) URL.revokeObjectURL(file.url); });
  files = files.map(hydrateProjectFile);
  files.forEach(file => { if (file.kind === 'asset' && file.blob) file.url = URL.createObjectURL(file.blob); });
  state.projectFiles = new Map(files.map(file => [file.path, file]));
  state.projectName = name || '论文项目';
  state.chatMessages = [];
  state.pendingChatChanges = [];
  els.chatMessagesEl.innerHTML = '<div class="chat-empty">在这里询问整篇论文、要求生成修改计划，或让 AI 给出需确认后应用的跨文件建议。</div>';
  els.chatChangesEl.hidden = true;
  els.chatChangesEl.replaceChildren();
  els.chatContextEl.textContent = '项目上下文待收集';
  document.querySelector('#project-name').textContent = state.projectName;
  const paths = [...state.projectFiles.keys()];
  const main = (preferredPath && state.projectFiles.has(preferredPath) ? preferredPath : '') || paths.find(path => /(^|\/)main\.tex$/i.test(path)) || paths.find(path => /\.tex$/i.test(path)) || paths.find(path => state.projectFiles.get(path).kind === 'text') || paths[0];
  if (!main) { showToast('项目中没有可读取的文件'); return; }
  state.currentPath = '';
  openProjectFile(main);
  if (persist) {
    cacheProject(serializeProjectFiles).catch(error => showToast(`项目缓存失败：${error.message}`));
    showToast(`已载入 ${files.length} 个文件`);
  }
}

export async function openFiles(fileList) {
  const source = [...fileList];
  if (!source.length) return;
  const rootName = source[0].webkitRelativePath?.split('/')[0] || source[0].name;
  try {
    const files = await Promise.all(source.map(async file => {
      const path = file.webkitRelativePath || file.name;
      const kind = fileKind(path);
      return { path, kind, mime: file.type || (path.toLowerCase().endsWith('.pdf') ? 'application/pdf' : ''), content: kind === 'text' ? await file.text() : '', blob: kind === 'text' ? null : file };
    }));
    loadProject(files, rootName);
  } catch (error) {
    showToast(`读取失败：${error.message}`);
  }
}

export async function openSingleFile(file) {
  if (!file) return;
  const name = file.name || 'untitled.txt';
  if (/\.zip$/i.test(name)) {
    showToast('ZIP 项目请使用“从 ZIP 创建项目”');
    return;
  }
  if (/\.doc$/i.test(name)) {
    showToast('暂不支持旧版 .doc，请另存为 .docx 或 txt 后再打开。');
    return;
  }
  try {
    if (/\.docx$/i.test(name)) {
      const response = await fetch('/api/import-document', {
        method: 'POST',
        headers: {
          'Content-Type': file.type || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'X-File-Name': encodeURIComponent(name),
        },
        body: file,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Word 文档读取失败');
      loadProject([data.file], name);
      return;
    }
    const kind = fileKind(name);
    if (kind !== 'text') {
      showToast('打开文件仅支持可编辑文本或 .docx 文档');
      return;
    }
    loadProject([{
      path: name,
      kind: 'text',
      mime: file.type || 'text/plain;charset=utf-8',
      content: await file.text(),
      blob: null,
    }], name);
  } catch (error) {
    showToast(`读取失败：${error.message}`);
  }
}

export async function parseZipProject(file) {
  const response = await fetch('/api/project', { method: 'POST', headers: { 'Content-Type': 'application/zip' }, body: file });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'ZIP 读取失败');
  return data.files.map(parsedProjectFile);
}

export async function createProjectFromZip(file) {
  els.resultStatus.textContent = '正在创建项目文件夹';
  try {
    const response = await fetch('/api/create-project-from-zip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/zip', 'X-Project-Name': encodeURIComponent(file.name) },
      body: file,
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '从 ZIP 创建项目失败');
    const files = data.files.map(parsedProjectFile);
    loadProject(files, data.name || file.name.replace(/\.zip$/i, ''));
    document.querySelector('#save-state').textContent = '已保存到项目文件夹';
    els.resultStatus.textContent = '项目已载入';
    showToast('已创建项目文件夹 ' + (data.path || data.name));
  } catch (error) {
    els.resultStatus.textContent = '导入失败';
    showToast(error.message || '从 ZIP 创建项目失败');
  }
}

export async function readDirectory(handle, prefix = '') {
  const files = [];
  for await (const [name, entry] of handle.entries()) {
    const path = prefix ? `${prefix}/${name}` : name;
    if (entry.kind === 'directory') {
      files.push(...await readDirectory(entry, path));
      continue;
    }
    const file = await entry.getFile();
    const kind = fileKind(path);
    files.push({ path, kind, mime: file.type || (path.toLowerCase().endsWith('.pdf') ? 'application/pdf' : ''), content: kind === 'text' ? await file.text() : '', blob: kind === 'text' ? null : file, handle: entry });
  }
  return files;
}

export async function openProjectFolder() {
  if (!window.showDirectoryPicker) {
    els.folderInput.click();
    return;
  }
  try {
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    const files = await readDirectory(handle);
    loadProject(files, handle.name);
  } catch (error) {
    if (error.name !== 'AbortError') showToast(`项目读取失败：${error.message}`);
  }
}

export async function restoreProject() {
  try {
    const project = await getCachedProject();
    if (!project?.files?.length) return;
    loadProject(project.files, project.name, project.currentPath, false);
    document.querySelector('#save-state').textContent = '已恢复上次项目';
    showToast(`已恢复 ${project.name}`);
  } catch (error) {
    showToast(`恢复项目失败：${error.message}`);
  }
}

export async function serializeProjectFiles() {
  const files = [];
  for (const file of state.projectFiles.values()) {
    const { url, ...stored } = file;
    if (file.kind !== 'asset') {
      files.push(stored);
      continue;
    }
    if (file.blob) {
      try {
        stored.content = bufferToBase64(await file.blob.arrayBuffer());
        stored.encoding = 'base64';
        stored.size = file.blob.size || file.size || 0;
        delete stored.blob;
      } catch {
        if (!stored.content || stored.encoding !== 'base64') delete stored.blob;
      }
    }
    files.push(stored);
  }
  return files;
}

export async function refreshAssetFromHandle(file) {
  if (!file.handle?.getFile) return false;
  try {
    const fresh = await file.handle.getFile();
    const previousUrl = file.url || '';
    file.blob = fresh;
    file.mime = fresh.type || file.mime || (file.path.toLowerCase().endsWith('.pdf') ? 'application/pdf' : '');
    file.size = fresh.size;
    if (previousUrl) URL.revokeObjectURL(previousUrl);
    file.url = URL.createObjectURL(fresh);
    return true;
  } catch {
    return false;
  }
}

export async function collectProjectFiles(includeGenerated = true) {
  const files = [];
  for (const file of state.projectFiles.values()) {
    if (!includeGenerated && file.generated) continue;
    if (file.kind === 'text') files.push({ path: file.path, content: file.content });
    else if (file.blob || file.handle) {
      try {
        await refreshAssetFromHandle(file);
        if ((!file.blob || typeof file.blob.arrayBuffer !== 'function') && file.encoding === 'base64' && file.content) {
          file.blob = base64Blob(file.content, file.mime || 'application/octet-stream');
          file.url = URL.createObjectURL(file.blob);
        }
        if (!file.blob) throw new Error('本地缓存中没有可用资源内容');
        files.push({ path: file.path, content: bufferToBase64(await file.blob.arrayBuffer()), encoding: 'base64' });
      } catch (error) {
        throw new Error(friendlyFileError(error, file.path));
      }
    }
    else throw new Error(`文件内容不可用：${file.path}`);
  }
  return files;
}

export async function exportProject() {
  saveCurrentFile();
  const button = document.querySelector('#export-project');
  button.disabled = true;
  button.textContent = '正在导出…';
  try {
    const files = await collectProjectFiles();
    const response = await fetch('/api/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ files }) });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || '导出失败');
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${state.projectName.replace(/[^\p{L}\p{N}_.-]+/gu, '_') || 'paper-project'}.zip`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast(`已导出 ${files.length} 个文件`);
  } catch (error) {
    showToast(error.message || '导出失败');
  } finally {
    button.disabled = false;
    button.textContent = '导出 ZIP';
  }
}

export function initDefaultProject() {
  const saved = localStorage.getItem('papercraft-document');
  if (saved) els.editor.value = saved;
  state.projectFiles.set(state.currentPath, { path: state.currentPath, kind: 'text', mime: 'text/x-tex', content: els.editor.value });
}
