import { getCachedProject, cacheProject } from './db.js?v=20260625-draft-generator';
import { saveCurrentFile, updateEditorMeta, captureSelection, autoSave } from './editor.js?v=20260625-draft-generator';
import { resetPdfPreview } from './pdf_preview.js?v=20260625-draft-generator';
import { base64Blob, bufferToBase64, els, showToast, state } from './state.js?v=20260625-draft-generator';
import { uiText } from './ui_language.js?v=20260625-draft-generator';

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
    if (!response.ok) throw new Error(data.error || uiText('toast.writebackFailed'));
    return 'server';
  }
  return false;
}

export function friendlyFileError(error, path) {
  const message = String(error?.message || error || '');
  if (/object can ?not be found here/i.test(message) || error?.name === 'NotFoundError') {
    return uiText('toast.resourceExpired', { path });
  }
  return uiText('toast.fileReadFailed', { path, message: message || uiText('toast.unknownError') });
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
      const message = document.createElement('div'); message.className = 'unsupported'; message.textContent = uiText('toast.unsupportedPreview'); els.filePreview.append(message);
    }
  }
  els.selectionCount.textContent = file.kind === 'text' ? uiText('editor.notSelected') : uiText('editor.resourcePreview');
  renderTree();
}

export function loadProject(files, name, preferredPath = '', persist = true) {
  saveCurrentFile();
  resetPdfPreview();
  state.projectFiles.forEach(file => { if (file.url) URL.revokeObjectURL(file.url); });
  files = files.map(hydrateProjectFile);
  files.forEach(file => { if (file.kind === 'asset' && file.blob) file.url = URL.createObjectURL(file.blob); });
  state.projectFiles = new Map(files.map(file => [file.path, file]));
  state.projectName = name || uiText('toast.paperProject');
  state.chatMessages = [];
  state.pendingChatChanges = [];
  els.chatMessagesEl.innerHTML = `<div class="chat-empty" data-i18n="chat.empty">${uiText('chat.empty')}</div>`;
  els.chatChangesEl.hidden = true;
  els.chatChangesEl.replaceChildren();
  els.chatContextEl.textContent = uiText('chat.contextPending');
  document.querySelector('#project-name').textContent = state.projectName;
  const paths = [...state.projectFiles.keys()];
  const main = (preferredPath && state.projectFiles.has(preferredPath) ? preferredPath : '') || paths.find(path => /(^|\/)main\.tex$/i.test(path)) || paths.find(path => /\.tex$/i.test(path)) || paths.find(path => state.projectFiles.get(path).kind === 'text') || paths[0];
  if (!main) { showToast(uiText('toast.noReadableFiles')); return; }
  state.currentPath = '';
  openProjectFile(main);
  if (persist) {
    cacheProject(serializeProjectFiles).catch(error => showToast(uiText('toast.projectCacheFailed', { message: error.message })));
    showToast(uiText('toast.loadedFiles', { count: files.length }));
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
    showToast(uiText('toast.readFailed', { message: error.message }));
  }
}

export async function openSingleFile(file) {
  if (!file) return;
  const name = file.name || 'untitled.txt';
  if (/\.zip$/i.test(name)) {
    showToast(uiText('toast.zipUseCreateProject'));
    return;
  }
  if (/\.doc$/i.test(name)) {
    showToast(uiText('toast.docUnsupported'));
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
      if (!response.ok) throw new Error(data.error || uiText('toast.wordReadFailed'));
      loadProject([data.file], name);
      return;
    }
    const kind = fileKind(name);
    if (kind !== 'text') {
      showToast(uiText('toast.singleFileOnly'));
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
    showToast(uiText('toast.readFailed', { message: error.message }));
  }
}

export async function parseZipProject(file) {
  const response = await fetch('/api/project', { method: 'POST', headers: { 'Content-Type': 'application/zip' }, body: file });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || uiText('toast.zipReadFailed'));
  return data.files.map(parsedProjectFile);
}

export async function createProjectFromZip(file) {
  els.resultStatus.textContent = uiText('result.creatingProject');
  try {
    const response = await fetch('/api/create-project-from-zip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/zip', 'X-Project-Name': encodeURIComponent(file.name) },
      body: file,
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || uiText('toast.createZipFailed'));
    const files = data.files.map(parsedProjectFile);
    loadProject(files, data.name || file.name.replace(/\.zip$/i, ''));
    document.querySelector('#save-state').textContent = uiText('app.saveServer');
    els.resultStatus.textContent = uiText('result.projectLoaded');
    showToast(uiText('toast.createdProjectFolder', { path: data.path || data.name }));
  } catch (error) {
    els.resultStatus.textContent = uiText('result.importFailed');
    showToast(error.message || uiText('toast.createZipFailed'));
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
    if (error.name !== 'AbortError') showToast(uiText('toast.projectReadFailed', { message: error.message }));
  }
}

export async function restoreProject() {
  try {
    const project = await getCachedProject();
    if (!project?.files?.length) return;
    loadProject(project.files, project.name, project.currentPath, false);
    document.querySelector('#save-state').textContent = uiText('toast.restoredLastProject');
    showToast(uiText('toast.restoredProject', { name: project.name }));
  } catch (error) {
    showToast(uiText('toast.restoreFailed', { message: error.message }));
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
        if (!file.blob) throw new Error(uiText('toast.noCachedAsset'));
        files.push({ path: file.path, content: bufferToBase64(await file.blob.arrayBuffer()), encoding: 'base64' });
      } catch (error) {
        throw new Error(friendlyFileError(error, file.path));
      }
    }
    else throw new Error(uiText('toast.fileContentUnavailable', { path: file.path }));
  }
  return files;
}

export async function exportProject() {
  saveCurrentFile();
  const button = document.querySelector('#export-project');
  button.disabled = true;
  button.textContent = uiText('toolbar.exporting');
  try {
    const files = await collectProjectFiles();
    const response = await fetch('/api/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ files }) });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || uiText('toast.exportFailed'));
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${state.projectName.replace(/[^\p{L}\p{N}_.-]+/gu, '_') || 'paper-project'}.zip`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast(uiText('toast.exportedFiles', { count: files.length }));
  } catch (error) {
    showToast(error.message || uiText('toast.exportFailed'));
  } finally {
    button.disabled = false;
    button.textContent = uiText('toolbar.exportZip');
  }
}

export function initDefaultProject() {
  const saved = localStorage.getItem('papercraft-document');
  if (saved) els.editor.value = saved;
  state.projectFiles.set(state.currentPath, { path: state.currentPath, kind: 'text', mime: 'text/x-tex', content: els.editor.value });
}
