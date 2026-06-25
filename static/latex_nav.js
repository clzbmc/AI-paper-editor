import { getCursorPosition, getValue, positionAtLine, revealRange } from './code_editor.js?v=20260625-codemirror-editor';
import { captureSelection, openProjectFile } from './editor.js?v=20260625-codemirror-editor';
import { escapeRegExp, normalizeProjectPath, showToast, state } from './state.js?v=20260625-codemirror-editor';
import { uiText } from './ui_language.js?v=20260625-codemirror-editor';

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
    revealRange(match.index, match.index + match[0].length);
    captureSelection();
  });
  showToast(message);
  return true;
}

export function navigateLatexReference() {
  const position = getCursorPosition();
  const commandPattern = /\\(cite|citep|citet|ref|eqref|autoref|pageref|input|include|includegraphics)(?:\[[^\]]*\])*\{([^}]*)\}/g;
  let command;
  const content = getValue();
  while ((command = commandPattern.exec(content))) {
    if (position < command.index || position > command.index + command[0].length) continue;
    const type = command[1];
    const argument = command[2].trim();
    if (/^(cite|citep|citet)$/.test(type)) {
      for (const key of argument.split(',').map(item => item.trim())) {
        const pattern = new RegExp(`@[a-zA-Z]+\\s*\\{\\s*${escapeRegExp(key)}\\s*,`, 'i');
        for (const [path, file] of state.projectFiles) {
          if (/\.bib$/i.test(path) && file.kind === 'text' && revealTextDefinition(path, pattern, uiText('toast.locatedCitation', { key }))) return;
        }
      }
    } else if (/^(ref|eqref|autoref|pageref)$/.test(type)) {
      const pattern = new RegExp(`\\\\label\\s*\\{\\s*${escapeRegExp(argument)}\\s*\\}`);
      for (const [path, file] of state.projectFiles) {
        if (file.kind === 'text' && revealTextDefinition(path, pattern, uiText('toast.locatedLabel', { label: argument }))) return;
      }
    } else {
      const extensions = type === 'includegraphics' ? ['', '.pdf', '.png', '.jpg', '.jpeg', '.svg', '.webp'] : ['', '.tex'];
      const path = resolveProjectFile(argument, extensions);
      if (path) { openProjectFile(path); showToast(uiText('toast.openedPath', { path })); return; }
    }
    showToast(uiText('toast.notFoundDefinition', { target: argument }));
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
  if (!file || file.kind !== 'text') { showToast(uiText('toast.sourceNotFound', { path })); return; }
  openProjectFile(resolved);
  requestAnimationFrame(() => {
    const lines = getValue().split('\n');
    const targetLine = Math.max(1, Math.min(Number(line) || 1, lines.length));
    const start = positionAtLine(targetLine);
    revealRange(start, start + lines[targetLine - 1].length);
    captureSelection();
  });
}
