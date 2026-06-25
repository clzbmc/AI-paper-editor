import { getValue } from './code_editor.js?v=20260625-codemirror-editor';
import { els, showToast, state } from './state.js?v=20260625-codemirror-editor';
import { uiText } from './ui_language.js?v=20260625-codemirror-editor';

export const MEMORY_PATH = '.papercraft/project_memory.json';
const MEMORY_SOURCE_TYPES = ['current', 'template', 'legacy', 'ambiguous', 'ignored'];
const MEMORY_VERSION = 1;
const MEMORY_SAMPLE_LIMIT = 180000;
const MEMORY_FILE_LIMIT = 16000;
const MEMORY_TEX_EXTENSIONS = /\.(tex|latex)$/i;

export function isMemoryPath(path) {
  return path === MEMORY_PATH || path.startsWith('.papercraft/');
}

function hashText(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function projectFingerprint(files = memorySourceFiles()) {
  return files.map(file => `${file.path}:${file.content.length}:${hashText(file.content)}`).sort().join('|');
}

function findMainMemoryPath(files) {
  return files.find(file => /(^|\/)main\.tex$/i.test(file.path))?.path
    || (MEMORY_TEX_EXTENSIONS.test(state.currentPath) ? state.currentPath : '')
    || files.find(file => MEMORY_TEX_EXTENSIONS.test(file.path))?.path
    || '';
}

function stripLatexComments(content) {
  return String(content || '').split('\n').map(line => {
    let escaped = false;
    for (let index = 0; index < line.length; index++) {
      const char = line[index];
      if (char === '\\') {
        escaped = !escaped;
        continue;
      }
      if (char === '%' && !escaped) return line.slice(0, index);
      escaped = false;
    }
    return line;
  }).join('\n');
}

function resolveTexReference(reference, fromPath, byPath) {
  const normalized = reference.replace(/\\/g, '/').replace(/^\.\//, '');
  const baseDir = fromPath.includes('/') ? fromPath.slice(0, fromPath.lastIndexOf('/')) : '';
  const candidates = [
    normalized,
    `${normalized}.tex`,
    baseDir ? `${baseDir}/${normalized}` : '',
    baseDir ? `${baseDir}/${normalized}.tex` : '',
  ].filter(Boolean);
  return candidates.find(candidate => byPath.has(candidate))
    || [...byPath.keys()].find(path => candidates.some(candidate => path.endsWith(`/${candidate}`)))
    || '';
}

function referencedTexFiles(entryPath, byPath, visited = new Set()) {
  if (!entryPath || visited.has(entryPath) || !byPath.has(entryPath)) return visited;
  visited.add(entryPath);
  const content = stripLatexComments(byPath.get(entryPath).content);
  const pattern = /\\(?:input|include)\{([^}]*)\}/g;
  let match;
  while ((match = pattern.exec(content))) {
    const found = resolveTexReference(match[1], entryPath, byPath);
    if (found) referencedTexFiles(found, byPath, visited);
  }
  return visited;
}

function commandArgumentText(match, command, argument) {
  if (/^(section|subsection|subsubsection|paragraph|subparagraph|title|caption)$/.test(command)) return `\n\n[PAPERCRAFT_HEADING] ${argument}\n\n`;
  if (/^(emph|textit|textbf|texttt|mathrm|mathbf|underline)$/.test(command)) return argument;
  if (/^(cite|citep|citet|parencite|textcite|ref|eqref|autoref|label|url|href|includegraphics)$/.test(command)) return '';
  return argument || '';
}

function removeLatexEnvironments(text) {
  const noisyEnvironments = ['equation', 'align', 'gather', 'multline', 'table', 'tabular', 'figure', 'lstlisting', 'verbatim', 'tikzpicture'];
  return noisyEnvironments.reduce((result, environment) => {
    const pattern = new RegExp(`\\\\begin\\{${environment}\\*?\\}[\\s\\S]*?\\\\end\\{${environment}\\*?\\}`, 'gi');
    return result.replace(pattern, '\n\n');
  }, text);
}

function cleanLatexForMemory(content) {
  let text = stripLatexComments(content);
  text = text.replace(/^[\s\S]*?\\begin\{document\}/i, '');
  text = text.replace(/\\end\{document\}[\s\S]*$/i, '');
  text = removeLatexEnvironments(text);
  text = text.replace(/\$\$[\s\S]*?\$\$/g, ' ');
  text = text.replace(/\$[^$\n]{1,240}\$/g, ' ');
  text = text.replace(/\\\[[\s\S]*?\\\]/g, ' ');
  text = text.replace(/\\\([\s\S]*?\\\)/g, ' ');
  text = text.replace(/\\(?:usepackage|documentclass|newcommand|renewcommand|def|DeclareMathOperator|bibliographystyle|bibliography|setlength|vspace|hspace|noindent|maketitle|tableofcontents)\b(?:\[[^\]]*\])?(?:\{[^}]*\})*/gi, '\n');
  text = text.replace(/\\begin\{abstract\}/gi, '\n\nAbstract\n\n').replace(/\\end\{abstract\}/gi, '\n\n');
  text = text.replace(/\\([a-zA-Z@]+)\*?(?:\[[^\]]*\])?\{([^{}]*)\}/g, commandArgumentText);
  text = text.replace(/\\[a-zA-Z@]+\*?(?:\[[^\]]*\])?/g, ' ');
  text = text.replace(/[{}]/g, ' ');
  const paragraphs = text.split(/\n\s*\n+/).map(paragraph => paragraph.replace(/\s+/g, ' ').trim()).filter(Boolean);
  return paragraphs.filter(paragraph => {
    const isHeading = paragraph.startsWith('[PAPERCRAFT_HEADING]');
    const letters = (paragraph.match(/[A-Za-z]/g) || []).length;
    const commands = (paragraph.match(/\\/g) || []).length;
    const sentenceMarks = (paragraph.match(/[.!?。！？]/g) || []).length;
    if (isHeading && letters >= 3) return true;
    if (paragraph.length < 45 && !/^(abstract|introduction|methods?|results?|discussion|conclusions?)$/i.test(paragraph)) return false;
    if (letters < 25) return false;
    if (commands > Math.max(2, paragraph.length / 80)) return false;
    if (sentenceMarks < 1 && paragraph.length < 120) return false;
    return true;
  }).map(paragraph => paragraph.replace(/^\[PAPERCRAFT_HEADING\]\s*/, '')).join('\n\n');
}

function memorySourceFiles() {
  const current = state.projectFiles.get(state.currentPath);
  if (current?.kind === 'text') current.content = getValue();
  const texFiles = [...state.projectFiles.values()]
    .filter(file => file.kind === 'text' && !isMemoryPath(file.path) && MEMORY_TEX_EXTENSIONS.test(file.path))
    .map(file => ({ path: file.path, kind: 'text', content: String(file.content || '') }));
  const byPath = new Map(texFiles.map(file => [file.path, file]));
  const mainPath = findMainMemoryPath(texFiles);
  const included = referencedTexFiles(mainPath, byPath);
  return [...included].map(path => {
    const file = byPath.get(path);
    const cleaned = cleanLatexForMemory(file.content);
    return {
      path,
      kind: 'text',
      content: cleaned,
      original_length: file.content.length,
      cleaned_length: cleaned.length,
      memory_entry: path === mainPath,
    };
  })
    .filter(file => file.content.trim());
}

function filePriority(file) {
  if (file.memory_entry) return 0;
  if (/(abstract|introduction|intro|method|methods|result|results|discussion|conclusion|conclusions)/i.test(file.path)) return 1;
  return 2;
}

function representativeSlice(content, limit = MEMORY_FILE_LIMIT) {
  if (content.length <= limit) return content;
  const half = Math.floor(limit / 2);
  const headings = [...content.matchAll(/\\(?:begin\{abstract\}|section|subsection|subsubsection)\*?\{?(abstract|introduction|method|methods|result|results|discussion|conclusion|conclusions)?/gi)];
  const anchor = headings[0]?.index ?? 0;
  const start = Math.max(0, Math.min(anchor, content.length - limit));
  const focused = content.slice(start, start + half);
  const tail = content.slice(Math.max(start + half, content.length - (limit - focused.length)));
  return `${focused}\n\n% ... PaperCraft memory sample truncated ...\n\n${tail}`.slice(0, limit);
}

function sampledMemoryFiles(files) {
  const sorted = [...files].sort((a, b) => filePriority(a) - filePriority(b) || a.path.localeCompare(b.path));
  const sampled = [];
  let total = 0;
  for (const file of sorted) {
    if (total >= MEMORY_SAMPLE_LIMIT) break;
    const remaining = MEMORY_SAMPLE_LIMIT - total;
    const limit = Math.min(MEMORY_FILE_LIMIT, remaining);
    if (limit < 1000) break;
    const content = representativeSlice(file.content, limit);
    sampled.push({
      ...file,
      content,
      truncated: content.length < file.content.length,
      original_length: file.original_length || file.content.length,
      cleaned_length: file.cleaned_length || file.content.length,
    });
    total += content.length;
  }
  return {
    files: sampled,
    sampled: sampled.some(file => file.truncated) || sampled.length < files.length,
    source_strategy: 'main_tex_clean_text',
    excluded_file_types: ['sty', 'cls', 'bst', 'rtx', 'bib', 'txt', 'md', 'unreferenced_tex'],
    original_file_count: [...state.projectFiles.values()].filter(file => file.kind === 'text' && !isMemoryPath(file.path)).length,
    included_file_count: files.length,
    sampled_file_count: sampled.length,
    original_total_length: files.reduce((sum, file) => sum + (file.original_length || file.content.length), 0),
    cleaned_total_length: files.reduce((sum, file) => sum + file.content.length, 0),
    sampled_total_length: total,
  };
}

function manualOverrides(memory) {
  return Object.fromEntries((memory?.entries || []).filter(entry => entry.manual).map(entry => [entry.id, {
    source_type: entry.source_type,
    confidence: entry.confidence,
    rationale: entry.rationale,
  }]));
}

function normalizeMemory(memory, fingerprint = '') {
  const entries = Array.isArray(memory?.entries) ? memory.entries : [];
  return {
    version: MEMORY_VERSION,
    generated_at: memory?.generated_at || Math.floor(Date.now() / 1000),
    confirmed: Boolean(memory?.confirmed),
    fingerprint: memory?.fingerprint || fingerprint,
    sampled: Boolean(memory?.sampled),
    sample_info: memory?.sample_info || null,
    project_summary: String(memory?.project_summary || ''),
    keywords: Array.isArray(memory?.keywords) ? memory.keywords : [],
    entries: entries.map((entry, index) => ({
      id: String(entry.id || `entry-${index}`),
      path: String(entry.path || ''),
      heading: String(entry.heading || ''),
      summary: String(entry.summary || ''),
      keywords: Array.isArray(entry.keywords) ? entry.keywords : [],
      terms: Array.isArray(entry.terms) ? entry.terms : [],
      citations: Array.isArray(entry.citations) ? entry.citations : [],
      source_type: MEMORY_SOURCE_TYPES.includes(entry.source_type) ? entry.source_type : 'ambiguous',
      confidence: Number.isFinite(Number(entry.confidence)) ? Math.max(0, Math.min(1, Number(entry.confidence))) : 0.5,
      rationale: String(entry.rationale || ''),
      manual: Boolean(entry.manual),
    })),
    demo: Boolean(memory?.demo),
  };
}

function memoryFile() {
  return state.projectFiles.get(MEMORY_PATH);
}

function loadMemoryFromFile() {
  const file = memoryFile();
  if (!file?.content) return null;
  try {
    return normalizeMemory(JSON.parse(file.content));
  } catch {
    return null;
  }
}

async function ensureMemoryFileHandle() {
  if (!state.projectDirectoryHandle?.getDirectoryHandle) return null;
  const directory = await state.projectDirectoryHandle.getDirectoryHandle('.papercraft', { create: true });
  return directory.getFileHandle('project_memory.json', { create: true });
}

async function saveMemory(memory) {
  const content = JSON.stringify(memory, null, 2);
  let file = memoryFile();
  if (!file) {
    const template = [...state.projectFiles.values()].find(item => item.serverRootId || item.handle) || {};
    file = {
      path: MEMORY_PATH,
      kind: 'text',
      mime: 'application/json',
      content,
      serverRootId: template.serverRootId,
      serverWritable: template.serverWritable,
    };
    state.projectFiles.set(MEMORY_PATH, file);
  }
  file.content = content;
  try {
    if (!file.handle) {
      const handle = await ensureMemoryFileHandle();
      if (handle) file.handle = handle;
    }
    if (file.handle) {
      const permission = await file.handle.queryPermission({ mode: 'readwrite' });
      const granted = permission === 'granted' || await file.handle.requestPermission({ mode: 'readwrite' }) === 'granted';
      if (granted) {
        const writable = await file.handle.createWritable();
        await writable.write(file.content);
        await writable.close();
      }
    } else if (file.serverRootId && file.serverWritable) {
      const response = await fetch('/api/save-project-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ root_id: file.serverRootId, path: file.path, content: file.content }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || uiText('toast.writebackFailed'));
      }
    }
  } catch (error) {
    console.warn('Project memory source writeback failed:', error);
    // IndexedDB/export still keep the sidecar even when source writeback is unavailable.
  }
  window.dispatchEvent(new CustomEvent('papercraft-memory-saved'));
}

function applyMemoryExpanded(expanded) {
  state.projectMemoryExpanded = Boolean(expanded);
  if (els.memoryCard) els.memoryCard.classList.toggle('collapsed', !state.projectMemoryExpanded);
  if (els.memoryToggle) {
    els.memoryToggle.textContent = uiText(state.projectMemoryExpanded ? 'memory.collapse' : 'memory.expand');
    els.memoryToggle.classList.toggle('secondary', state.projectMemoryExpanded);
    els.memoryToggle.setAttribute('aria-expanded', String(state.projectMemoryExpanded));
  }
  if (els.memoryActions) els.memoryActions.hidden = !state.projectMemoryExpanded;
  if (els.memoryList) els.memoryList.hidden = !state.projectMemoryExpanded;
}

export function toggleProjectMemory() {
  applyMemoryExpanded(!state.projectMemoryExpanded);
}

function loadExistingMemory(fingerprint) {
  const existing = loadMemoryFromFile();
  if (!existing?.entries?.length) return null;
  const matches = existing.fingerprint === fingerprint;
  state.projectMemory = existing;
  state.projectMemoryDirty = !matches;
  state.projectMemoryStatus = matches ? 'ready' : 'stale';
  applyMemoryExpanded(matches ? !existing.confirmed : true);
  renderProjectMemory();
  return existing;
}

export function renderProjectMemory() {
  const memory = state.projectMemory;
  const count = memory?.entries?.length || 0;
  if (!els.memoryStatus || !els.memoryList) return;
  const statusKey = {
    idle: 'memory.idle',
    building: 'memory.building',
    ready: memory?.sampled ? (memory?.confirmed ? 'memory.sampledReady' : 'memory.sampledReview') : (memory?.confirmed ? 'memory.ready' : 'memory.review'),
    stale: 'memory.stale',
    failed: 'memory.failed',
  }[state.projectMemoryStatus] || 'memory.idle';
  els.memoryStatus.textContent = uiText(statusKey, { count });
  applyMemoryExpanded(state.projectMemoryExpanded);
  els.memoryList.replaceChildren();
  if (!count) {
    els.memoryList.append(Object.assign(document.createElement('p'), { textContent: uiText('memory.empty') }));
    return;
  }
  memory.entries.slice(0, 80).forEach(entry => {
    const article = document.createElement('article');
    article.className = `memory-item ${entry.source_type}`;
    const head = document.createElement('div');
    head.className = 'memory-item-head';
    const title = document.createElement('b');
    title.textContent = entry.heading || entry.path || entry.id;
    const path = document.createElement('small');
    path.textContent = `${entry.path} · ${Math.round(entry.confidence * 100)}%`;
    const select = document.createElement('select');
    MEMORY_SOURCE_TYPES.forEach(type => {
      const option = document.createElement('option');
      option.value = type;
      option.textContent = uiText(`memory.type.${type}`);
      option.selected = entry.source_type === type;
      select.append(option);
    });
    select.onchange = async () => {
      entry.source_type = select.value;
      entry.manual = true;
      entry.confidence = select.value === 'current' ? Math.max(entry.confidence, 0.9) : entry.confidence;
      state.projectMemory.confirmed = false;
      await saveMemory(state.projectMemory);
      renderProjectMemory();
      showToast(uiText('toast.memorySaved'));
    };
    head.append(title, path, select);
    const summary = document.createElement('p');
    summary.textContent = entry.summary || entry.rationale || uiText('memory.noSummary');
    article.append(head, summary);
    els.memoryList.append(article);
  });
}

export async function buildProjectMemory(force = false) {
  const files = memorySourceFiles();
  const fingerprint = projectFingerprint(files);
  const existing = loadMemoryFromFile();
  if (!force) {
    const loaded = loadExistingMemory(fingerprint);
    if (loaded) return loaded;
  }
  if (!files.length) {
    state.projectMemory = null;
    state.projectMemoryStatus = 'idle';
    state.projectMemoryExpanded = true;
    renderProjectMemory();
    return null;
  }
  state.projectMemoryStatus = 'building';
  state.projectMemoryExpanded = true;
  renderProjectMemory();
  try {
    const sample = sampledMemoryFiles(files);
    const response = await fetch('/api/project-memory/build', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: sample.files, sampled: sample.sampled, sample_info: sample, manual_overrides: manualOverrides(existing) }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || uiText('toast.memoryFailed'));
    const memory = normalizeMemory(data, fingerprint);
    memory.fingerprint = fingerprint;
    memory.sampled = Boolean(data.sampled || sample.sampled);
    memory.sample_info = data.sample_info || sample;
    if (existing?.entries?.length) {
      const overrides = new Map(existing.entries.filter(entry => entry.manual).map(entry => [entry.id, entry]));
      memory.entries = memory.entries.map(entry => overrides.has(entry.id) ? { ...entry, ...overrides.get(entry.id), manual: true } : entry);
    }
    state.projectMemory = memory;
    state.projectMemoryStatus = 'ready';
    state.projectMemoryDirty = false;
    state.projectMemoryExpanded = !memory.confirmed;
    await saveMemory(memory);
    renderProjectMemory();
    showToast(memory.sampled ? uiText('toast.memorySampled') : data.demo ? uiText('toast.memoryDemo') : uiText('toast.memoryReady'));
    return memory;
  } catch (error) {
    state.projectMemoryStatus = 'failed';
    renderProjectMemory();
    showToast(error.message);
    return null;
  }
}

export function markProjectMemoryStale() {
  if (!state.projectMemory) return;
  state.projectMemoryDirty = true;
  state.projectMemoryStatus = 'stale';
  state.projectMemoryExpanded = !state.projectMemory.confirmed;
  renderProjectMemory();
}

export async function confirmProjectMemory() {
  if (!state.projectMemory) return;
  state.projectMemory.confirmed = true;
  state.projectMemoryStatus = 'ready';
  await saveMemory(state.projectMemory);
  state.projectMemoryExpanded = false;
  renderProjectMemory();
  showToast(uiText('toast.memoryConfirmed'));
}

export async function retrieveProjectMemory(query, task = 'rewrite', limit = 6) {
  const memory = state.projectMemory || loadMemoryFromFile();
  if (!memory?.entries?.length) return [];
  try {
    const response = await fetch('/api/project-memory/retrieve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memory, query, task, current_path: state.currentPath, limit }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || uiText('toast.memoryRetrieveFailed'));
    return data.items || [];
  } catch {
    return [];
  }
}
