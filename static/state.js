export const els = {
  editor: document.querySelector('#editor'),
  selectionCount: document.querySelector('#selection-count'),
  cursorPosition: document.querySelector('#cursor-position'),
  wordCount: document.querySelector('#word-count'),
  results: document.querySelector('#results'),
  resultStatus: document.querySelector('#result-status'),
  rewriteButton: document.querySelector('#rewrite'),
  toast: document.querySelector('#toast'),
  fileInput: document.querySelector('#file-input'),
  zipProjectInput: document.querySelector('#zip-project-input'),
  folderInput: document.querySelector('#folder-input'),
  editorShell: document.querySelector('.editor-shell'),
  filePreview: document.querySelector('#file-preview'),
  treeFiles: document.querySelector('#tree-files'),
  workspace: document.querySelector('.workspace'),
  editorPane: document.querySelector('#editor-pane'),
  controlPane: document.querySelector('#control-pane'),
  resultPane: document.querySelector('#result-pane'),
  editorBody: document.querySelector('.editor-body'),
  writingPrompt: document.querySelector('#writing-prompt'),
  modeSelect: document.querySelector('#mode-select'),
  promptModeLabel: document.querySelector('#prompt-mode-label'),
  promptCount: document.querySelector('#prompt-count'),
  memoryCard: document.querySelector('#memory-card'),
  memoryStatus: document.querySelector('#memory-status'),
  memoryRefresh: document.querySelector('#memory-refresh'),
  memoryToggle: document.querySelector('#memory-toggle'),
  memoryActions: document.querySelector('#memory-actions'),
  memoryConfirm: document.querySelector('#memory-confirm'),
  memoryList: document.querySelector('#memory-list'),
  draftInput: document.querySelector('#draft-input'),
  draftGenerate: document.querySelector('#draft-generate'),
  draftResult: document.querySelector('#draft-result'),
  draftOutput: document.querySelector('#draft-output'),
  draftReason: document.querySelector('#draft-reason'),
  draftStatus: document.querySelector('#draft-status'),
  draftPanel: document.querySelector('#draft-panel'),
  feedbackList: document.querySelector('#feedback-list'),
  feedbackButton: document.querySelector('#feedback-analyze'),
  chatPanel: document.querySelector('#project-chat'),
  chatMessagesEl: document.querySelector('#chat-messages'),
  chatChangesEl: document.querySelector('#chat-changes'),
  chatContextEl: document.querySelector('#chat-context'),
  chatInput: document.querySelector('#chat-input'),
  chatSend: document.querySelector('#chat-send'),
  pdfDownloadButton: document.querySelector('#pdf-download'),
  pdfFullscreenButton: document.querySelector('#pdf-fullscreen'),
  languageToggle: document.querySelector('#language-toggle'),
};

export const DEFAULT_PROMPTS = {
  all: '请分别提供三个版本：A 保守修订，仅修正语法与清晰度；B 学术强化，使表达更严谨正式；C 精简表达，删除冗余但保留原意。三个版本均须保持技术含义一致。',
  safe: '请进行保守修订。尽量保留原句结构、措辞和作者语气，只修正语法、拼写、标点、冠词、时态及明显不自然的表达，不要扩写或改变论证。',
  academic: '请强化学术表达。提高语言的严谨性、正式程度和逻辑连贯性，使用适合英文学术论文的措辞，但不要添加原文没有的事实、结论或因果关系。',
  concise: '请精简表达。删除重复、空泛和不必要的措辞，缩短句子并提高信息密度，同时完整保留技术含义、限定条件和论证逻辑。',
};

export const state = {
  selectedRange: null,
  activeMode: 'all',
  currentPath: 'untitled-paper.tex',
  projectFiles: new Map(),
  projectName: '未命名项目',
  uiLanguage: localStorage.getItem('papercraft-ui-language') === 'en' ? 'en' : 'zh',
  saveTimer: null,
  viewSaveTimer: null,
  lineNumberTimer: null,
  lastMeasuredValue: '',
  lastMeasuredWidth: 0,
  layout: JSON.parse(localStorage.getItem('papercraft-layout') || '{}'),
  customPrompts: { ...DEFAULT_PROMPTS, ...JSON.parse(localStorage.getItem('papercraft-prompts') || '{}') },
  findMatches: [],
  findIndex: -1,
  findHasNavigated: false,
  compileTimer: null,
  compileRunning: false,
  chatMessages: [],
  pendingChatChanges: [],
  currentPdf: null,
  projectDirectoryHandle: null,
  projectMemory: null,
  projectMemoryStatus: 'idle',
  projectMemoryDirty: false,
  projectMemoryExpanded: true,
};

export function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

export function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add('show');
  setTimeout(() => els.toast.classList.remove('show'), 1800);
}

export function base64Blob(content, mime) {
  const bytes = Uint8Array.from(atob(content), char => char.charCodeAt(0));
  return new Blob([bytes], { type: mime });
}

export function bufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 32768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  }
  return btoa(binary);
}

export function cacheBustedUrl(url) {
  if (!url) return '';
  return url + (url.includes('?') ? '&' : '?') + 't=' + Date.now();
}

export function normalizeProjectPath(path) {
  const parts = [];
  path.replace(/\\/g, '/').split('/').forEach(part => {
    if (!part || part === '.') return;
    if (part === '..') parts.pop();
    else parts.push(part);
  });
  return parts.join('/');
}

export function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
