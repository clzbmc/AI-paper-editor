import { captureSelection, openProjectFile } from './editor.js';
import { escapeRegExp, els, normalizeProjectPath, showToast, state } from './state.js';

export function resolveProjectFile(target, extensions = ['']) {
  const directory = state.currentPath.includes('/') ? state.currentPath.slice(0, state.currentPath.lastIndexOf('/') + 1) : '';
  const candidates = extensions.map(extension => normalizeProjectPath(`${directory}${target}${extension}`));
  for (const candidate of candidates) if (state.projectFiles.has(candidate)) return candidate;
  const match = [...state.projectFiles.keys()].find(path => candidates.some(candidate => path.endsWith(`/${candidate}`)) || extensions.some(extension => path === `${target}${extension}` || path.endsWith(`/${target}${extension}`)));
  if (match) return match;
  return '';
}

export function revealTextDefinition(path, pattern, message) {
  const file = state.projectFiles.get(path);
  if (!file || file.kind !== 'text') return false;
  const match = pattern.exec(file.content);
  if (!match) return false;
  openProjectFile(path);
  requestAnimationFrame(() => {
    els.editor.focus({ preventScroll: true });
    els.editor.setSelectionRange(match.index, match.index + match[0].length);
    const lineHeight = parseFloat(getComputedStyle(els.editor).lineHeight) || 22;
    const line = file.content.slice(0, match.index).split('\n').length - 1;
    els.editor.scrollTop = Math.max(0, line * lineHeight - els.editor.clientHeight / 3);
    captureSelection();
  });
  showToast(message);
  return true;
}

export function navigateLatexReference() {
  const position = els.editor.selectionStart;
  const commandPattern = /\\(cite|citep|citet|ref|eqref|autoref|pageref|input|include|includegraphics)(?:\[[^\]]*\])*\{([^}]*)\}/g;
  let command;
  while ((command = commandPattern.exec(els.editor.value))) {
    if (position < command.index || position > command.index + command[0].length) continue;
    const type = command[1];
    const argument = command[2].trim();
    if (/^(cite|citep|citet)$/.test(type)) {
      for (const key of argument.split(',').map(item => item.trim())) {
        const pattern = new RegExp(`@[a-zA-Z]+\\s*\\{\\s*${escapeRegExp(key)}\\s*,`, 'i');
        for (const [path, file] of state.projectFiles) {
          if (/\.bib$/i.test(path) && file.kind === 'text' && revealTextDefinition(path, pattern, `已定位文献 ${key}`)) return;
        }
      }
    } else if (/^(ref|eqref|autoref|pageref)$/.test(type)) {
      const pattern = new RegExp(`\\\\label\\s*\\{\\s*${escapeRegExp(argument)}\\s*\\}`);
      for (const [path, file] of state.projectFiles) {
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

export function resolveDiagnosticPath(path) {
  const normalized = normalizeProjectPath(path);
  if (state.projectFiles.has(normalized)) return normalized;
  return [...state.projectFiles.keys()].find(candidate => candidate.endsWith(`/${normalized}`) || candidate.endsWith(`/${path.split('/').at(-1)}`)) || '';
}

export function revealSourceLine(path, line) {
  const resolved = resolveDiagnosticPath(path);
  const file = state.projectFiles.get(resolved);
  if (!file || file.kind !== 'text') { showToast(`找不到源码 ${path}`); return; }
  openProjectFile(resolved);
  requestAnimationFrame(() => {
    const lines = els.editor.value.split('\n');
    const targetLine = Math.max(1, Math.min(Number(line) || 1, lines.length));
    const start = lines.slice(0, targetLine - 1).reduce((length, value) => length + value.length + 1, 0);
    els.editor.focus({ preventScroll: true });
    els.editor.setSelectionRange(start, start + lines[targetLine - 1].length);
    els.editor.scrollTop = Math.max(0, (targetLine - 1) * (parseFloat(getComputedStyle(els.editor).lineHeight) || 22) - els.editor.clientHeight / 3);
    captureSelection();
  });
}
