const editor = document.querySelector('#editor');
const lineNumbers = document.querySelector('#line-numbers');
const selectionCount = document.querySelector('#selection-count');
const cursorPosition = document.querySelector('#cursor-position');
const wordCount = document.querySelector('#word-count');
const results = document.querySelector('#results');
const resultStatus = document.querySelector('#result-status');
const rewriteButton = document.querySelector('#rewrite');
const toast = document.querySelector('#toast');
const fileInput = document.querySelector('#file-input');
const folderInput = document.querySelector('#folder-input');
const editorShell = document.querySelector('.editor-shell');
const filePreview = document.querySelector('#file-preview');
const treeFiles = document.querySelector('#tree-files');
const lineMeasure = document.querySelector('#line-measure');
const workspace = document.querySelector('.workspace');
const editorPane = document.querySelector('#editor-pane');
const controlPane = document.querySelector('#control-pane');
const resultPane = document.querySelector('#result-pane');
const editorBody = document.querySelector('.editor-body');
const writingPrompt = document.querySelector('#writing-prompt');
const modeSelect = document.querySelector('#mode-select');
const promptModeLabel = document.querySelector('#prompt-mode-label');
const promptCount = document.querySelector('#prompt-count');
const feedbackList = document.querySelector('#feedback-list');
const feedbackButton = document.querySelector('#feedback-analyze');
const chatPanel = document.querySelector('#project-chat');
const chatMessagesEl = document.querySelector('#chat-messages');
const chatChangesEl = document.querySelector('#chat-changes');
const chatContextEl = document.querySelector('#chat-context');
const chatInput = document.querySelector('#chat-input');
const chatSend = document.querySelector('#chat-send');
const pdfDownloadButton = document.querySelector('#pdf-download');
const pdfFullscreenButton = document.querySelector('#pdf-fullscreen');
let selectedRange = null;
let activeMode = 'all';
let currentPath = 'untitled-paper.tex';
let projectFiles = new Map();
let projectName = '未命名项目';
let saveTimer = null;
let viewSaveTimer = null;
let lineNumberTimer = null;
let lastMeasuredValue = '';
let lastMeasuredWidth = 0;
let layout = JSON.parse(localStorage.getItem('papercraft-layout') || '{}');
const DEFAULT_PROMPTS = {
  all: '请分别提供三个版本：A 保守修订，仅修正语法与清晰度；B 学术强化，使表达更严谨正式；C 精简表达，删除冗余但保留原意。三个版本均须保持技术含义一致。',
  safe: '请进行保守修订。尽量保留原句结构、措辞和作者语气，只修正语法、拼写、标点、冠词、时态及明显不自然的表达，不要扩写或改变论证。',
  academic: '请强化学术表达。提高语言的严谨性、正式程度和逻辑连贯性，使用适合英文学术论文的措辞，但不要添加原文没有的事实、结论或因果关系。',
  concise: '请精简表达。删除重复、空泛和不必要的措辞，缩短句子并提高信息密度，同时完整保留技术含义、限定条件和论证逻辑。',
};
let customPrompts = { ...DEFAULT_PROMPTS, ...JSON.parse(localStorage.getItem('papercraft-prompts') || '{}') };
let findMatches = [];
let findIndex = -1;
let compileTimer = null;
let compileRunning = false;
let chatMessages = [];
let pendingChatChanges = [];
let currentPdf = null;
const MODE_LABELS = { all: '全部版本', safe: '保守修订', academic: '强化学术表达', concise: '精简表达' };

function showModePrompt() {
  writingPrompt.value = customPrompts[activeMode] || DEFAULT_PROMPTS[activeMode];
  promptModeLabel.textContent = MODE_LABELS[activeMode];
  if (modeSelect) modeSelect.value = activeMode;
  promptCount.textContent = `${writingPrompt.value.length} / 4000`;
}

function saveModePrompt() {
  customPrompts[activeMode] = writingPrompt.value;
  localStorage.setItem('papercraft-prompts', JSON.stringify(customPrompts));
  promptCount.textContent = `${writingPrompt.value.length} / 4000`;
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

function persistLayout() {
  localStorage.setItem('papercraft-layout', JSON.stringify(layout));
}

function applyLayout() {
  const total = workspace.clientWidth;
  if (layout.editor || layout.control) {
    const editorWidth = clamp(layout.editor || editorPane.getBoundingClientRect().width, 380, total - 548);
    const controlWidth = clamp(layout.control || controlPane.getBoundingClientRect().width, 230, total - editorWidth - 312);
    layout.editor = editorWidth;
    layout.control = controlWidth;
    workspace.style.gridTemplateColumns = `${editorWidth}px 6px ${controlWidth}px 6px minmax(300px, 1fr)`;
  }
  if (layout.tree) {
    layout.tree = clamp(layout.tree, 115, Math.max(115, editorPane.clientWidth - 260));
    editorBody.style.gridTemplateColumns = `${layout.tree}px 5px minmax(0, 1fr)`;
  }
}

function makeResizable(resizer, onMove, onFinish) {
  resizer.addEventListener('pointerdown', event => {
    event.preventDefault();
    const startX = event.clientX;
    resizer.classList.add('dragging');
    document.body.classList.add('resizing');
    resizer.setPointerCapture(event.pointerId);
    const move = moveEvent => onMove(moveEvent.clientX - startX);
    const finish = () => {
      resizer.removeEventListener('pointermove', move);
      resizer.removeEventListener('pointerup', finish);
      resizer.removeEventListener('pointercancel', finish);
      resizer.classList.remove('dragging');
      document.body.classList.remove('resizing');
      onFinish();
      scheduleLineNumbers(true);
    };
    resizer.addEventListener('pointermove', move);
    resizer.addEventListener('pointerup', finish);
    resizer.addEventListener('pointercancel', finish);
  });
}

function setupResizableLayout() {
  applyLayout();
  makeResizable(document.querySelector('#editor-resizer'), delta => {
    const total = workspace.clientWidth;
    const controlWidth = controlPane.getBoundingClientRect().width;
    layout.editor = clamp((layout.dragEditorStart ?? editorPane.getBoundingClientRect().width) + delta, 380, total - controlWidth - 312);
    workspace.style.gridTemplateColumns = `${layout.editor}px 6px ${controlWidth}px 6px minmax(300px, 1fr)`;
  }, () => { delete layout.dragEditorStart; layout.control = controlPane.getBoundingClientRect().width; persistLayout(); });
  document.querySelector('#editor-resizer').addEventListener('pointerdown', () => { layout.dragEditorStart = editorPane.getBoundingClientRect().width; });

  makeResizable(document.querySelector('#control-resizer'), delta => {
    const total = workspace.clientWidth;
    const editorWidth = editorPane.getBoundingClientRect().width;
    layout.control = clamp((layout.dragControlStart ?? controlPane.getBoundingClientRect().width) + delta, 230, total - editorWidth - 312);
    workspace.style.gridTemplateColumns = `${editorWidth}px 6px ${layout.control}px 6px minmax(300px, 1fr)`;
  }, () => { delete layout.dragControlStart; layout.editor = editorPane.getBoundingClientRect().width; persistLayout(); });
  document.querySelector('#control-resizer').addEventListener('pointerdown', () => { layout.dragControlStart = controlPane.getBoundingClientRect().width; });

  makeResizable(document.querySelector('#tree-resizer'), delta => {
    layout.tree = clamp((layout.dragTreeStart ?? document.querySelector('#project-tree').getBoundingClientRect().width) + delta, 115, editorPane.clientWidth - 260);
    editorBody.style.gridTemplateColumns = `${layout.tree}px 5px minmax(0, 1fr)`;
  }, () => { delete layout.dragTreeStart; persistLayout(); });
  document.querySelector('#tree-resizer').addEventListener('pointerdown', () => { layout.dragTreeStart = document.querySelector('#project-tree').getBoundingClientRect().width; });
}

function refreshLineNumbers(force = false) {
  const computed = getComputedStyle(editor);
  const contentWidth = Math.max(40, editor.clientWidth - parseFloat(computed.paddingLeft) - parseFloat(computed.paddingRight));
  if (!force && lastMeasuredValue === editor.value && Math.abs(lastMeasuredWidth - contentWidth) < 1) return;
  lastMeasuredValue = editor.value;
  lastMeasuredWidth = contentWidth;
  lineMeasure.style.width = `${contentWidth}px`;
  const lines = editor.value.split('\n');
  const measureFragment = document.createDocumentFragment();
  lines.forEach(line => {
    const row = document.createElement('div');
    row.textContent = line || '\u200b';
    measureFragment.append(row);
  });
  lineMeasure.replaceChildren(measureFragment);
  const numberFragment = document.createDocumentFragment();
  [...lineMeasure.children].forEach((row, index) => {
    const number = document.createElement('span');
    number.textContent = index + 1;
    number.style.height = `${row.getBoundingClientRect().height}px`;
    numberFragment.append(number);
  });
  lineNumbers.replaceChildren(numberFragment);
  lineNumbers.scrollTop = editor.scrollTop;
}

function scheduleLineNumbers(force = false) {
  clearTimeout(lineNumberTimer);
  lineNumberTimer = setTimeout(() => refreshLineNumbers(force), 90);
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('papercraft-ai', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('projects');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function cacheProject() {
  const db = await openDatabase();
  const files = await serializeProjectFiles();
  await new Promise((resolve, reject) => {
    const transaction = db.transaction('projects', 'readwrite');
    transaction.objectStore('projects').put({ name: projectName, currentPath, files, updatedAt: Date.now() }, 'active');
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
}

async function getCachedProject() {
  const db = await openDatabase();
  const project = await new Promise((resolve, reject) => {
    const request = db.transaction('projects').objectStore('projects').get('active');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return project;
}

async function writeToSource(file) {
  if (!file?.handle || file.kind !== 'text') return false;
  const permission = await file.handle.queryPermission({ mode: 'readwrite' });
  if (permission !== 'granted') return false;
  const writable = await file.handle.createWritable();
  await writable.write(file.content);
  await writable.close();
  return true;
}

async function autoSave(path = currentPath) {
  saveCurrentFile();
  const file = projectFiles.get(path);
  document.querySelector('#save-state').textContent = '保存中…';
  try {
    const [, wroteSource] = await Promise.all([cacheProject(), writeToSource(file)]);
    document.querySelector('#save-state').textContent = wroteSource ? '已保存到原文件' : '已自动保存';
  } catch (error) {
    document.querySelector('#save-state').textContent = '保存失败';
    showToast(`自动保存失败：${error.message}`);
  }
}

function scheduleAutoSave() {
  document.querySelector('#save-state').textContent = '编辑中';
  clearTimeout(saveTimer);
  const path = currentPath;
  saveTimer = setTimeout(() => autoSave(path), 600);
}

function scheduleViewSave() {
  saveCurrentFile();
  clearTimeout(viewSaveTimer);
  viewSaveTimer = setTimeout(() => {
    cacheProject().catch(error => showToast(`视图状态保存失败：${error.message}`));
  }, 350);
}

function updateFindMatches(reset = false) {
  const query = document.querySelector('#find-text').value;
  findMatches = [];
  if (query) {
    const source = editor.value.toLocaleLowerCase();
    const needle = query.toLocaleLowerCase();
    let position = 0;
    while ((position = source.indexOf(needle, position)) !== -1) {
      findMatches.push({ start: position, end: position + query.length });
      position += Math.max(1, query.length);
    }
  }
  if (reset) findIndex = findMatches.length ? 0 : -1;
  else if (findIndex >= findMatches.length) findIndex = findMatches.length - 1;
  document.querySelector('#find-status').textContent = `${findIndex < 0 ? 0 : findIndex + 1} / ${findMatches.length}`;
}

function revealFindMatch(index) {
  if (!findMatches.length) return;
  findIndex = (index + findMatches.length) % findMatches.length;
  const match = findMatches[findIndex];
  editor.focus({ preventScroll: true });
  editor.setSelectionRange(match.start, match.end);
  const line = editor.value.slice(0, match.start).split('\n').length - 1;
  editor.scrollTop = Math.max(0, line * (parseFloat(getComputedStyle(editor).lineHeight) || 22) - editor.clientHeight / 3);
  document.querySelector('#find-status').textContent = `${findIndex + 1} / ${findMatches.length}`;
}

function showFindBar() {
  document.querySelector('#find-bar').hidden = false;
  const input = document.querySelector('#find-text');
  input.focus(); input.select(); updateFindMatches(true);
}

function replaceFindMatch() {
  if (findIndex < 0 || !findMatches[findIndex]) return;
  const match = findMatches[findIndex];
  editor.setRangeText(document.querySelector('#replace-text').value, match.start, match.end, 'select');
  editor.dispatchEvent(new Event('input', { bubbles: true }));
  updateFindMatches(true); revealFindMatch(0);
}

function replaceAllMatches() {
  if (!findMatches.length) return;
  const replacement = document.querySelector('#replace-text').value;
  const count = findMatches.length;
  for (let index = findMatches.length - 1; index >= 0; index--) {
    const match = findMatches[index];
    editor.setRangeText(replacement, match.start, match.end, 'preserve');
  }
  editor.dispatchEvent(new Event('input', { bubbles: true }));
  updateFindMatches(true); showToast(`已替换 ${count} 处`);
}

function updateEditorMeta() {
  scheduleLineNumbers();
  const beforeCursor = editor.value.slice(0, editor.selectionStart).split('\n');
  cursorPosition.textContent = `Ln ${beforeCursor.length}, Col ${beforeCursor.at(-1).length + 1}`;
  wordCount.textContent = `${(editor.value.match(/[\p{L}\p{N}_-]+/gu) || []).length} words`;
}

function clearLockedSelection() {
  selectedRange = null;
  selectionCount.textContent = '未选择文本';
  resultStatus.textContent = '等待选区';
}

function captureSelection() {
  updateEditorMeta();
  scheduleViewSave();
  if (editor.selectionStart === editor.selectionEnd) {
    clearLockedSelection();
    return;
  }
  selectedRange = { start: editor.selectionStart, end: editor.selectionEnd, text: editor.value.slice(editor.selectionStart, editor.selectionEnd) };
  selectionCount.textContent = `已选择 ${selectedRange.text.length} 字符`;
  resultStatus.textContent = '选区已就绪';
}

function getContext() {
  if (!selectedRange) return { before: '', after: '' };
  const before = editor.value.slice(0, selectedRange.start).split(/\n\s*\n/).slice(-3).join('\n\n');
  const after = editor.value.slice(selectedRange.end).split(/\n\s*\n/).slice(0, 3).join('\n\n');
  return { before, after };
}

function showToast(message) {
  toast.textContent = message; toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 1800);
}

function friendlyFileError(error, path) {
  const message = String(error?.message || error || '');
  if (/object can ?not be found here/i.test(message) || error?.name === 'NotFoundError') {
    return `资源缓存已失效：${path}。请重新打开一次项目文件夹以重建缓存。`;
  }
  return `${path} 读取失败：${message || '未知错误'}`;
}

function hydrateProjectFile(file) {
  if (file?.kind === 'asset' && file.encoding === 'base64' && typeof file.content === 'string') {
    const blob = base64Blob(file.content, file.mime || 'application/octet-stream');
    const { content, encoding, url, ...asset } = file;
    return { ...asset, blob, size: file.size || blob.size };
  }
  return file;
}

function fileKind(path) {
  if (/\.(tex|latex|bib|sty|cls|bst|rtx|txt|md)$/i.test(path)) return 'text';
  if (/\.(pdf|png|jpe?g|gif|svg|webp)$/i.test(path)) return 'asset';
  return 'other';
}

function fileIcon(path) {
  if (/\.tex$/i.test(path)) return 'T';
  if (/\.bib$/i.test(path)) return 'B';
  if (/\.pdf$/i.test(path)) return 'P';
  if (/\.(png|jpe?g|gif|svg|webp)$/i.test(path)) return '▧';
  return '·';
}

function renderTree() {
  treeFiles.innerHTML = '';
  [...projectFiles.keys()].sort((a, b) => a.localeCompare(b)).forEach(path => {
    const button = document.createElement('button');
    button.className = `tree-file${path === currentPath ? ' active' : ''}`;
    button.dataset.path = path;
    button.title = path;
    button.style.paddingLeft = `${7 + Math.min(path.split('/').length - 1, 4) * 10}px`;
    const icon = document.createElement('span'); icon.textContent = fileIcon(path);
    button.append(icon, document.createTextNode(path.split('/').at(-1)));
    button.onclick = () => openProjectFile(path);
    treeFiles.append(button);
  });
}

function saveCurrentFile() {
  const current = projectFiles.get(currentPath);
  if (current?.kind === 'text') {
    current.content = editor.value;
    current.view = {
      scrollTop: editor.scrollTop,
      scrollLeft: editor.scrollLeft,
      selectionStart: editor.selectionStart,
      selectionEnd: editor.selectionEnd,
    };
  }
}

function openProjectFile(path) {
  const previousPath = currentPath;
  saveCurrentFile();
  if (previousPath && previousPath !== path) autoSave(previousPath);
  const file = projectFiles.get(path);
  if (!file) return;
  currentPath = path;
  document.querySelector('#document-title').value = path.split('/').at(-1);
  selectedRange = null;
  filePreview.replaceChildren();
  if (file.kind === 'text') {
    editor.hidden = false; lineNumbers.hidden = false; filePreview.hidden = true;
    editor.value = file.content;
    const view = file.view || {};
    const selectionStart = Math.min(view.selectionStart ?? 0, editor.value.length);
    const selectionEnd = Math.min(view.selectionEnd ?? selectionStart, editor.value.length);
    editor.focus({ preventScroll: true });
    editor.setSelectionRange(selectionStart, selectionEnd);
    updateEditorMeta();
    requestAnimationFrame(() => {
      editor.scrollTop = view.scrollTop ?? 0;
      editor.scrollLeft = view.scrollLeft ?? 0;
      lineNumbers.scrollTop = editor.scrollTop;
    });
  } else {
    editor.hidden = true; lineNumbers.hidden = true; filePreview.hidden = false;
    if (file.kind === 'asset' && /^image\//.test(file.mime)) {
      const image = document.createElement('img'); image.src = file.url; image.alt = path; filePreview.append(image);
    } else if (file.kind === 'asset' && file.mime === 'application/pdf') {
      const frame = document.createElement('iframe'); frame.src = file.url; frame.title = path; filePreview.append(frame);
    } else {
      const message = document.createElement('div'); message.className = 'unsupported'; message.textContent = '该文件已纳入项目，但暂不支持预览。'; filePreview.append(message);
    }
  }
  selectionCount.textContent = file.kind === 'text' ? '未选择文本' : '资源预览';
  renderTree();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeProjectPath(path) {
  const parts = [];
  path.replace(/\\/g, '/').split('/').forEach(part => {
    if (!part || part === '.') return;
    if (part === '..') parts.pop();
    else parts.push(part);
  });
  return parts.join('/');
}

function resolveProjectFile(target, extensions = ['']) {
  const directory = currentPath.includes('/') ? currentPath.slice(0, currentPath.lastIndexOf('/') + 1) : '';
  const candidates = extensions.map(extension => normalizeProjectPath(`${directory}${target}${extension}`));
  for (const candidate of candidates) if (projectFiles.has(candidate)) return candidate;
  const match = [...projectFiles.keys()].find(path => candidates.some(candidate => path.endsWith(`/${candidate}`)) || extensions.some(extension => path === `${target}${extension}` || path.endsWith(`/${target}${extension}`)));
  if (match) return match;
  return '';
}

function revealTextDefinition(path, pattern, message) {
  const file = projectFiles.get(path);
  if (!file || file.kind !== 'text') return false;
  const match = pattern.exec(file.content);
  if (!match) return false;
  openProjectFile(path);
  requestAnimationFrame(() => {
    editor.focus({ preventScroll: true });
    editor.setSelectionRange(match.index, match.index + match[0].length);
    const lineHeight = parseFloat(getComputedStyle(editor).lineHeight) || 22;
    const line = file.content.slice(0, match.index).split('\n').length - 1;
    editor.scrollTop = Math.max(0, line * lineHeight - editor.clientHeight / 3);
    captureSelection();
  });
  showToast(message);
  return true;
}

function navigateLatexReference() {
  const position = editor.selectionStart;
  const commandPattern = /\\(cite|citep|citet|ref|eqref|autoref|pageref|input|include|includegraphics)(?:\[[^\]]*\])*\{([^}]*)\}/g;
  let command;
  while ((command = commandPattern.exec(editor.value))) {
    if (position < command.index || position > command.index + command[0].length) continue;
    const type = command[1];
    const argument = command[2].trim();
    if (/^(cite|citep|citet)$/.test(type)) {
      for (const key of argument.split(',').map(item => item.trim())) {
        const pattern = new RegExp(`@[a-zA-Z]+\\s*\\{\\s*${escapeRegExp(key)}\\s*,`, 'i');
        for (const [path, file] of projectFiles) {
          if (/\.bib$/i.test(path) && file.kind === 'text' && revealTextDefinition(path, pattern, `已定位文献 ${key}`)) return;
        }
      }
    } else if (/^(ref|eqref|autoref|pageref)$/.test(type)) {
      const pattern = new RegExp(`\\\\label\\s*\\{\\s*${escapeRegExp(argument)}\\s*\\}`);
      for (const [path, file] of projectFiles) {
        if (file.kind === 'text' && revealTextDefinition(path, pattern, `已定位标签 ${argument}`)) return;
      }
    } else {
      const extensions = type === 'includegraphics' ? ['', '.pdf', '.png', '.jpg', '.jpeg', '.svg', '.webp'] : ['', '.tex'];
      const path = resolveProjectFile(argument, extensions);
      if (path) { openProjectFile(path); showToast(`已打开 ${path}`); return; }
    }
    showToast(`未找到 ${argument} 的定义或文件`);
    return;
  }
}

function base64Blob(content, mime) {
  const bytes = Uint8Array.from(atob(content), char => char.charCodeAt(0));
  return new Blob([bytes], { type: mime });
}

function cacheBustedUrl(url) {
  if (!url) return '';
  return url + (url.includes('?') ? '&' : '?') + 't=' + Date.now();
}

async function resolvePdfPreviewUrl(serverUrl, fallbackUrl) {
  if (!serverUrl) return fallbackUrl;
  const previewUrl = cacheBustedUrl(serverUrl);
  try {
    const response = await fetch(previewUrl, { method: 'HEAD', cache: 'no-store' });
    if (response.ok || response.status === 206) return previewUrl;
  } catch {
    // Keep using the server URL below; browser PDF plugins are more reliable with HTTP than Blob.
  }
  return previewUrl;
}

function armPdfFallback(iframe, fallbackUrl) {
  iframe.dataset.fallbackSrc = fallbackUrl;
  iframe.onerror = () => {
    const fallback = iframe.dataset.fallbackSrc;
    if (fallback && iframe.src !== fallback) {
      iframe.src = fallback;
      showToast('PDF 预览地址失效，已切换到本地缓存');
    }
  };
}

function showPdfPreviewError() {
  const iframe = document.querySelector('#compiled-pdf');
  const placeholder = document.querySelector('#pdf-placeholder');
  iframe.hidden = true;
  iframe.removeAttribute('src');
  document.querySelector('#pdf-live-preview').classList.remove('ready');
  placeholder.textContent = 'PDF 已生成，但浏览器预览加载失败。请重新点击 PDF 标签或再次编译。';
  showToast('PDF 已生成，但预览加载失败');
}

function updatePdfActions() {
  const ready = Boolean(currentPdf?.url);
  pdfDownloadButton.disabled = !ready;
  pdfFullscreenButton.disabled = !ready;
}

function loadPdfPreview(previewUrl, fallbackUrl) {
  const iframe = document.querySelector('#compiled-pdf');
  armPdfFallback(iframe, fallbackUrl);
  iframe.dataset.pendingSrc = '';
  iframe.dataset.pendingFallback = '';
  document.querySelector('#pdf-live-preview').classList.add('ready');
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      try {
        iframe.hidden = false;
        iframe.src = previewUrl;
      } catch {
        showPdfPreviewError();
      }
    });
  });
}

function queuePdfPreview(previewUrl, fallbackUrl) {
  const iframe = document.querySelector('#compiled-pdf');
  iframe.dataset.pendingSrc = previewUrl;
  iframe.dataset.pendingFallback = fallbackUrl;
  document.querySelector('#pdf-live-preview').classList.add('ready');
}

function flushPendingPdfPreview() {
  const iframe = document.querySelector('#compiled-pdf');
  const pendingSrc = iframe.dataset.pendingSrc;
  if (pendingSrc) loadPdfPreview(pendingSrc, iframe.dataset.pendingFallback || pendingSrc);
}

function resetPdfPreview() {
  const iframe = document.querySelector('#compiled-pdf');
  const placeholder = document.querySelector('#pdf-placeholder');
  iframe.onerror = null;
  iframe.hidden = true;
  iframe.removeAttribute('src');
  delete iframe.dataset.fallbackSrc;
  delete iframe.dataset.pendingSrc;
  delete iframe.dataset.pendingFallback;
  currentPdf = null;
  updatePdfActions();
  placeholder.textContent = '尚未生成 PDF。请先安装本地 LaTeX 工具链，再点击“编译 PDF”。';
  document.querySelector('#pdf-live-preview').classList.remove('ready');
}

function downloadCurrentPdf() {
  if (!currentPdf?.url) { showToast('请先编译生成 PDF'); return; }
  const link = document.createElement('a');
  link.href = currentPdf.downloadUrl || currentPdf.url;
  link.download = currentPdf.name || 'papercraft.pdf';
  link.click();
}

function pdfZoomUrl(url, zoom = 200) {
  if (!url) return '';
  return url.split('#')[0] + `#zoom=${zoom}`;
}

async function openCurrentPdfFullscreen() {
  if (!currentPdf?.url) { showToast('请先编译生成 PDF'); return; }
  const zoomedUrl = pdfZoomUrl(currentPdf.url, 250);
  window.open(zoomedUrl, '_blank', 'noopener');
  showToast('已打开独立 PDF 预览器 · 250%');
}

function loadProject(files, name, preferredPath = '', persist = true) {
  saveCurrentFile();
  resetPdfPreview();
  projectFiles.forEach(file => { if (file.url) URL.revokeObjectURL(file.url); });
  files = files.map(hydrateProjectFile);
  files.forEach(file => { if (file.kind === 'asset' && file.blob) file.url = URL.createObjectURL(file.blob); });
  projectFiles = new Map(files.map(file => [file.path, file]));
  projectName = name || '论文项目';
  chatMessages = [];
  pendingChatChanges = [];
  chatMessagesEl.innerHTML = '<div class="chat-empty">在这里询问整篇论文、要求生成修改计划，或让 AI 给出需确认后应用的跨文件建议。</div>';
  chatChangesEl.hidden = true;
  chatChangesEl.replaceChildren();
  chatContextEl.textContent = '项目上下文待收集';
  document.querySelector('#project-name').textContent = projectName;
  const paths = [...projectFiles.keys()];
  const main = (preferredPath && projectFiles.has(preferredPath) ? preferredPath : '') || paths.find(path => /(^|\/)main\.tex$/i.test(path)) || paths.find(path => /\.tex$/i.test(path)) || paths.find(path => projectFiles.get(path).kind === 'text') || paths[0];
  if (!main) { showToast('项目中没有可读取的文件'); return; }
  currentPath = '';
  openProjectFile(main);
  if (persist) {
    cacheProject().catch(error => showToast(`项目缓存失败：${error.message}`));
    showToast(`已载入 ${files.length} 个文件`);
  }
}

async function openFiles(fileList) {
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

async function openZip(file) {
  resultStatus.textContent = '正在读取项目';
  try {
    const response = await fetch('/api/project', { method: 'POST', headers: { 'Content-Type': 'application/zip' }, body: file });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'ZIP 读取失败');
    const files = data.files.map(item => {
      if (item.kind === 'text') return item;
      const blob = base64Blob(item.content, item.mime);
      const { content, encoding, ...asset } = item;
      return { ...asset, blob };
    });
    loadProject(files, file.name.replace(/\.zip$/i, ''));
    resultStatus.textContent = '项目已载入';
  } catch (error) { showToast(error.message); resultStatus.textContent = '导入失败'; }
}

async function readDirectory(handle, prefix = '') {
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

async function openProjectFolder() {
  if (!window.showDirectoryPicker) {
    folderInput.click();
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

async function restoreProject() {
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

function bufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 32768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  }
  return btoa(binary);
}

async function serializeProjectFiles() {
  const files = [];
  for (const file of projectFiles.values()) {
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

async function refreshAssetFromHandle(file) {
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

async function collectProjectFiles(includeGenerated = true) {
  const files = [];
  for (const file of projectFiles.values()) {
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

async function exportProject() {
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
    link.download = `${projectName.replace(/[^\p{L}\p{N}_.-]+/gu, '_') || 'paper-project'}.zip`;
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

function findMainTexPath() {
  const paths = [...projectFiles.keys()];
  return paths.find(path => /(^|\/)main\.tex$/i.test(path)) || paths.find(path => /\.tex$/i.test(path)) || '';
}

function resolveDiagnosticPath(path) {
  const normalized = normalizeProjectPath(path);
  if (projectFiles.has(normalized)) return normalized;
  return [...projectFiles.keys()].find(candidate => candidate.endsWith(`/${normalized}`) || candidate.endsWith(`/${path.split('/').at(-1)}`)) || '';
}

function revealSourceLine(path, line) {
  const resolved = resolveDiagnosticPath(path);
  const file = projectFiles.get(resolved);
  if (!file || file.kind !== 'text') { showToast(`找不到源码 ${path}`); return; }
  openProjectFile(resolved);
  requestAnimationFrame(() => {
    const lines = editor.value.split('\n');
    const targetLine = Math.max(1, Math.min(Number(line) || 1, lines.length));
    const start = lines.slice(0, targetLine - 1).reduce((length, value) => length + value.length + 1, 0);
    editor.focus({ preventScroll: true });
    editor.setSelectionRange(start, start + lines[targetLine - 1].length);
    editor.scrollTop = Math.max(0, (targetLine - 1) * (parseFloat(getComputedStyle(editor).lineHeight) || 22) - editor.clientHeight / 3);
    captureSelection();
  });
}

function showCompileResult(data, ok) {
  const panel = document.querySelector('#compile-panel');
  const summary = document.querySelector('#compile-summary');
  const errors = document.querySelector('#compile-errors');
  panel.hidden = false;
  summary.textContent = ok ? `编译成功 · ${data.engine} · ${data.diagnostics?.length || 0} 条诊断` : data.error || '编译失败';
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

function switchResultView(view) {
  document.querySelectorAll('[data-result-view]').forEach(button => button.classList.toggle('active', button.dataset.resultView === view));
  results.hidden = view !== 'ai';
  document.querySelector('#pdf-live-preview').hidden = view !== 'pdf';
  chatPanel.hidden = view !== 'chat';
  if (view === 'pdf') requestAnimationFrame(flushPendingPdfPreview);
}

async function compileProject({ background = false } = {}) {
  if (compileRunning) return;
  saveCurrentFile();
  const main = findMainTexPath();
  if (!main) { showToast('项目中没有可编译的 TeX 主文件'); return; }
  compileRunning = true;
  const button = document.querySelector('#compile-project');
  button.disabled = true; button.textContent = '编译中…';
  try {
    const files = await collectProjectFiles(false);
    const response = await fetch('/api/compile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ main, files }) });
    const responseText = await response.text();
    let data;
    try {
      data = JSON.parse(responseText);
    } catch {
      data = { error: response.status === 404 ? '当前运行的服务尚未加载编译接口，请关闭启动器后重新打开。' : `编译服务返回了无法识别的响应（HTTP ${response.status}）。` };
    }
    if (!response.ok) {
      if (data.code === 'toolchain_missing') {
        document.querySelector('#auto-compile').checked = false;
        localStorage.setItem('papercraft-auto-compile', 'false');
      }
      showCompileResult(data, false);
      throw new Error(data.error || '编译失败');
    }
    const blob = base64Blob(data.pdf, 'application/pdf');
    const outputPath = `build/${data.pdf_name}`;
    const previous = projectFiles.get(outputPath);
    const previousUrl = previous?.url || '';
    const pdfUrl = URL.createObjectURL(blob);
    projectFiles.set(outputPath, { path: outputPath, kind: 'asset', mime: 'application/pdf', blob, url: pdfUrl, generated: true });
    const previewUrl = await resolvePdfPreviewUrl(data.pdf_url, pdfUrl);
    currentPdf = { url: previewUrl, downloadUrl: pdfUrl, name: data.pdf_name || 'papercraft.pdf' };
    updatePdfActions();
    if (!background) switchResultView('pdf');
    if (document.querySelector('#pdf-live-preview').hidden) queuePdfPreview(previewUrl, pdfUrl);
    else loadPdfPreview(previewUrl, pdfUrl);
    if (previousUrl && previousUrl !== pdfUrl) URL.revokeObjectURL(previousUrl);
    renderTree(); cacheProject().catch(() => {});
    if (!background) showToast('编译成功，PDF 已更新');
    else showToast('PDF 已自动更新');
  } catch (error) {
    showToast(error.message || '编译失败');
  } finally {
    compileRunning = false; button.disabled = false; button.textContent = '编译 PDF';
  }
}

function collectChatContext() {
  saveCurrentFile();
  const textFiles = [];
  const manifest = [];
  const current = currentPath;
  const main = findMainTexPath();
  const priority = path => (path === current ? 0 : path === main ? 1 : /\.bib$/i.test(path) ? 2 : /\.(tex|latex)$/i.test(path) ? 3 : 4);
  const sorted = [...projectFiles.values()].sort((a, b) => priority(a.path) - priority(b.path) || a.path.localeCompare(b.path));
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
  chatContextEl.textContent = `${textFiles.length} 个文本文件 · ${manifest.length} 个资源 · ${truncated ? '上下文已截断' : '上下文完整'}`;
  return { files: textFiles, resource_manifest: manifest, context_truncated: truncated };
}

function appendChatMessage(role, content) {
  if (chatMessagesEl.querySelector('.chat-empty')) chatMessagesEl.replaceChildren();
  const bubble = document.createElement('article');
  bubble.className = `chat-message ${role}`;
  const label = document.createElement('b');
  label.textContent = role === 'user' ? '你' : 'PaperCraft AI';
  const body = document.createElement('p');
  body.textContent = content;
  bubble.append(label, body);
  chatMessagesEl.append(bubble);
  chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
}

function renderChatChanges(changes = []) {
  pendingChatChanges = changes;
  chatChangesEl.hidden = !changes.length;
  chatChangesEl.replaceChildren();
  if (!changes.length) return;
  const title = document.createElement('div');
  title.className = 'chat-changes-title';
  title.textContent = `建议修改 ${changes.length} 处，确认后才会写入项目`;
  chatChangesEl.append(title);
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
    chatChangesEl.append(card);
  });
}

function applyChatChange(index) {
  const change = pendingChatChanges[index];
  if (!change?.path || !change.find) { showToast('修改建议不完整'); return; }
  const file = projectFiles.get(change.path);
  if (!file || file.kind !== 'text') { showToast('只能应用到文本文件'); return; }
  if (!file.content.includes(change.find)) { showToast('原文已变化，请重新生成建议'); return; }
  file.content = file.content.replace(change.find, change.replace || '');
  if (currentPath === change.path) editor.value = file.content;
  saveCurrentFile();
  scheduleAutoSave();
  updateEditorMeta();
  showToast('已应用修改并进入自动保存');
}

async function sendChatMessage() {
  const content = chatInput.value.trim();
  if (!content) return;
  chatInput.value = '';
  chatMessages.push({ role: 'user', content });
  appendChatMessage('user', content);
  chatSend.disabled = true;
  chatSend.textContent = '发送中…';
  try {
    const context = collectChatContext();
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: chatMessages, current_path: currentPath, ...context }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '项目对话失败');
    const reply = data.reply || '已收到。';
    chatMessages.push({ role: 'assistant', content: reply });
    appendChatMessage('assistant', reply);
    renderChatChanges(data.changes || []);
    if (data.demo) showToast('当前为离线演示对话');
  } catch (error) {
    appendChatMessage('assistant', `请求失败：${error.message}`);
    showToast(error.message);
  } finally {
    chatSend.disabled = false;
    chatSend.textContent = '发送';
  }
}

function scheduleAutoCompile() {
  if (!document.querySelector('#auto-compile').checked) return;
  clearTimeout(compileTimer);
  compileTimer = setTimeout(() => compileProject({ background: true }), 2200);
}

function tokenizeDiff(text) {
  return text.match(/\s+|\\[a-zA-Z@]+\*?|[\p{L}\p{N}_]+|[^\s]/gu) || [];
}

function calculateWordDiff(original, revised) {
  const before = tokenizeDiff(original);
  const after = tokenizeDiff(revised);
  if (before.length * after.length > 1_500_000) {
    let prefix = 0;
    while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++;
    let suffix = 0;
    while (suffix < before.length - prefix && suffix < after.length - prefix && before.at(-1 - suffix) === after.at(-1 - suffix)) suffix++;
    return [
      { type: 'same', tokens: before.slice(0, prefix) },
      { type: 'removed', tokens: before.slice(prefix, before.length - suffix) },
      { type: 'added', tokens: after.slice(prefix, after.length - suffix) },
      { type: 'same', tokens: suffix ? before.slice(before.length - suffix) : [] },
    ].filter(part => part.tokens.length);
  }
  const rows = Array.from({ length: before.length + 1 }, () => new Uint16Array(after.length + 1));
  for (let i = 1; i <= before.length; i++) {
    for (let j = 1; j <= after.length; j++) {
      rows[i][j] = before[i - 1] === after[j - 1] ? rows[i - 1][j - 1] + 1 : Math.max(rows[i - 1][j], rows[i][j - 1]);
    }
  }
  const operations = [];
  let i = before.length;
  let j = after.length;
  while (i || j) {
    if (i && j && before[i - 1] === after[j - 1]) {
      operations.push({ type: 'same', token: before[--i] }); j--;
    } else if (j && (!i || rows[i][j - 1] >= rows[i - 1][j])) {
      operations.push({ type: 'added', token: after[--j] });
    } else {
      operations.push({ type: 'removed', token: before[--i] });
    }
  }
  operations.reverse();
  return operations.reduce((parts, operation) => {
    const last = parts.at(-1);
    if (last?.type === operation.type) last.tokens.push(operation.token);
    else parts.push({ type: operation.type, tokens: [operation.token] });
    return parts;
  }, []);
}

function renderWordDiff(container, original, revised) {
  calculateWordDiff(original, revised).forEach(part => {
    const span = document.createElement(part.type === 'removed' ? 'del' : part.type === 'added' ? 'ins' : 'span');
    span.textContent = part.tokens.join('');
    container.append(span);
  });
}

function renderSuggestions(data, originalText) {
  const labels = { A: ['保守修订', '语法与清晰度'], B: ['学术强化', '严谨与专业'], C: ['精简表达', '简洁与直接'] };
  const visibleKeys = { all: ['A','B','C'], safe: ['A'], academic: ['B'], concise: ['C'] }[activeMode] || ['A','B','C'];
  results.innerHTML = (data.demo ? '<div class="demo-note">当前为离线演示模式。请在 model_config.json 中配置并启用模型。</div>' : '') +
    visibleKeys.map(key => `<article class="suggestion" data-version="${key}"><div class="suggestion-head"><span class="badge">${key}</span><b>${labels[key][0]}</b><small>${labels[key][1]}</small></div><pre class="suggestion-text"></pre><div class="suggestion-reason" hidden><b>修改理由</b><p></p></div><div class="diff-heading"><b>逐词 Diff</b><span><i class="removed-key"></i>删除</span><span><i class="added-key"></i>新增</span></div><div class="diff-text"></div><div class="suggestion-actions"><button class="copy">复制</button><button class="replace">替换选区</button></div></article>`).join('');
  [...results.querySelectorAll('.suggestion')].forEach((card, index) => {
    const value = data[card.dataset.version];
    card.querySelector('pre').textContent = value;
    const reason = data.reasons?.[card.dataset.version] || '';
    if (reason) {
      const reasonBox = card.querySelector('.suggestion-reason');
      reasonBox.hidden = false;
      reasonBox.querySelector('p').textContent = reason;
    }
    renderWordDiff(card.querySelector('.diff-text'), originalText, value);
    card.querySelector('.copy').onclick = async () => { await navigator.clipboard.writeText(value); showToast('已复制'); };
    card.querySelector('.replace').onclick = () => replaceSelection(value);
  });
}

function renderFeedback(data) {
  const items = data.feedback || [];
  if (!items.length) {
    feedbackList.replaceChildren(Object.assign(document.createElement('p'), { textContent: '暂未发现明显写作问题。' }));
    return;
  }
  feedbackList.replaceChildren(...items.map(item => {
    const article = document.createElement('article');
    article.className = `feedback-item ${item.severity || 'low'}`;
    const type = document.createElement('span');
    type.textContent = item.type || 'writing';
    const text = document.createElement('b');
    text.textContent = item.text || '';
    const suggestion = document.createElement('p');
    suggestion.textContent = item.suggestion || '';
    article.append(type, text, suggestion);
    return article;
  }));
}

async function analyzeFeedback() {
  saveCurrentFile();
  const file = projectFiles.get(currentPath);
  if (!file || file.kind !== 'text') {
    showToast('请先打开一个可编辑文本文件');
    return;
  }
  feedbackButton.disabled = true;
  feedbackButton.textContent = '分析中…';
  feedbackList.innerHTML = '<p>正在分析当前写作问题…</p>';
  try {
    const selection = selectedRange && editor.value.slice(selectedRange.start, selectedRange.end) === selectedRange.text ? selectedRange.text : '';
    const response = await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: currentPath,
        content: editor.value,
        selection,
        selection_start: selectedRange?.start || editor.selectionStart || 0,
        selection_end: selectedRange?.end || editor.selectionEnd || 0,
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '写作反馈失败');
    renderFeedback(data);
    showToast(data.demo ? '已生成演示反馈' : '写作反馈已更新');
  } catch (error) {
    feedbackList.innerHTML = '<p>写作反馈生成失败，请稍后重试。</p>';
    showToast(error.message);
  } finally {
    feedbackButton.disabled = false;
    feedbackButton.textContent = '分析当前文件';
  }
}

function replaceSelection(value) {
  if (!selectedRange || editor.value.slice(selectedRange.start, selectedRange.end) !== selectedRange.text) {
    showToast('原选区已变化，请重新选择'); return;
  }
  editor.focus();
  editor.setSelectionRange(selectedRange.start, selectedRange.end);
  document.execCommand('insertText', false, value);
  selectedRange = null;
  selectionCount.textContent = '未选择文本';
  resultStatus.textContent = '已应用'; updateEditorMeta(); showToast('已替换并保留撤销记录');
}

async function rewrite() {
  if (!selectedRange || editor.value.slice(selectedRange.start, selectedRange.end) !== selectedRange.text) {
    selectedRange = null;
    showToast('请先在编辑器中选中一段文本'); editor.focus();
    return;
  }
  const context = getContext();
  const originalText = selectedRange.text;
  rewriteButton.disabled = true; rewriteButton.textContent = '正在润色…'; resultStatus.textContent = 'AI 正在思考';
  try {
    const response = await fetch('/api/rewrite', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ text:selectedRange.text, context_before:context.before, context_after:context.after, mode:activeMode, custom_prompt:writingPrompt.value }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '润色失败');
    renderSuggestions(data, originalText); resultStatus.textContent = data.demo ? '演示结果' : '生成完成';
  } catch (error) { showToast(error.message); resultStatus.textContent = '请求失败'; }
  finally { rewriteButton.disabled = false; rewriteButton.textContent = '✦ 开始润色'; }
}

editor.addEventListener('pointerdown', () => {
  if (!selectedRange) return;
  const collapsePosition = editor.selectionEnd;
  clearLockedSelection();
  editor.setSelectionRange(collapsePosition, collapsePosition);
});
editor.addEventListener('dblclick', navigateLatexReference);
editor.addEventListener('click', event => { if (event.metaKey || event.ctrlKey) navigateLatexReference(); });
editor.addEventListener('select', captureSelection); editor.addEventListener('click', captureSelection); editor.addEventListener('keyup', captureSelection);
editor.addEventListener('input', () => { updateEditorMeta(); saveCurrentFile(); scheduleAutoSave(); scheduleAutoCompile(); });
editor.addEventListener('scroll', () => { lineNumbers.scrollTop = editor.scrollTop; scheduleViewSave(); });
lineNumbers.addEventListener('wheel', event => {
  event.preventDefault();
  editor.scrollBy({ top: event.deltaY, left: event.deltaX });
}, { passive: false });
modeSelect.onchange = () => { saveModePrompt(); activeMode = modeSelect.value; showModePrompt(); };
writingPrompt.addEventListener('input', saveModePrompt);
document.querySelector('#reset-prompt').onclick = () => { customPrompts[activeMode] = DEFAULT_PROMPTS[activeMode]; showModePrompt(); saveModePrompt(); showToast('已恢复当前目标的默认提示词'); };
feedbackButton.onclick = analyzeFeedback;
chatSend.onclick = sendChatMessage;
pdfDownloadButton.onclick = downloadCurrentPdf;
pdfFullscreenButton.onclick = openCurrentPdfFullscreen;
chatInput.addEventListener('keydown', event => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); sendChatMessage(); } });
document.querySelector('#find-toggle').onclick = showFindBar;
document.querySelector('#find-close').onclick = () => { document.querySelector('#find-bar').hidden = true; editor.focus(); };
document.querySelector('#find-text').addEventListener('input', () => { updateFindMatches(true); revealFindMatch(0); });
document.querySelector('#find-next').onclick = () => revealFindMatch(findIndex + 1);
document.querySelector('#find-prev').onclick = () => revealFindMatch(findIndex - 1);
document.querySelector('#replace-one').onclick = replaceFindMatch;
document.querySelector('#replace-all').onclick = replaceAllMatches;
document.addEventListener('pointerdown', event => {
  if (!selectedRange || event.target === editor) return;
  if (event.target.closest('button')) event.preventDefault();
});
document.querySelector('#undo').onclick = () => { editor.focus(); document.execCommand('undo'); };
document.querySelector('#redo').onclick = () => { editor.focus(); document.execCommand('redo'); };
document.querySelector('#open-file').onclick = () => fileInput.click();
document.querySelector('#open-folder').onclick = openProjectFolder;
document.querySelector('#export-project').onclick = exportProject;
document.querySelector('#compile-project').onclick = () => compileProject();
document.querySelector('#compile-close').onclick = () => { document.querySelector('#compile-panel').hidden = true; };
document.querySelector('#auto-compile').checked = localStorage.getItem('papercraft-auto-compile') === 'true';
document.querySelector('#auto-compile').onchange = event => localStorage.setItem('papercraft-auto-compile', String(event.target.checked));
document.querySelectorAll('[data-result-view]').forEach(button => button.onclick = () => switchResultView(button.dataset.resultView));
fileInput.onchange = () => { const file = fileInput.files[0]; file?.name.toLowerCase().endsWith('.zip') ? openZip(file) : openFiles(fileInput.files); fileInput.value = ''; };
folderInput.onchange = () => { openFiles(folderInput.files); folderInput.value = ''; };
['dragenter', 'dragover'].forEach(type => editorShell.addEventListener(type, event => { event.preventDefault(); editorShell.classList.add('dragging'); }));
['dragleave', 'drop'].forEach(type => editorShell.addEventListener(type, event => { event.preventDefault(); editorShell.classList.remove('dragging'); }));
editorShell.addEventListener('drop', event => { const files = event.dataTransfer.files; files[0]?.name.toLowerCase().endsWith('.zip') ? openZip(files[0]) : openFiles(files); });
document.querySelector('#polish-top').onclick = rewrite; rewriteButton.onclick = rewrite;
document.addEventListener('keydown', event => {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); rewrite(); }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') { event.preventDefault(); showFindBar(); }
  if (event.key === 'Escape' && !document.querySelector('#find-bar').hidden) { document.querySelector('#find-bar').hidden = true; editor.focus(); }
});
const saved = localStorage.getItem('papercraft-document'); if (saved) editor.value = saved;
projectFiles.set(currentPath, { path: currentPath, kind: 'text', mime: 'text/x-tex', content: editor.value });
updateEditorMeta();
restoreProject();
setupResizableLayout();
showModePrompt();
new ResizeObserver(() => scheduleLineNumbers(true)).observe(editor);
window.addEventListener('resize', () => { applyLayout(); scheduleLineNumbers(true); });
