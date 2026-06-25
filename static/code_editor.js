import {
  basicSetup,
  EditorState,
  EditorView,
  highlightSelectionMatches,
  redo,
  stex,
  StreamLanguage,
  undo,
} from './vendor/codemirror.bundle.js';
import { els } from './state.js?v=20260625-codemirror-editor';

export const DEFAULT_DOCUMENT = String.raw`\section{Introduction}

Computational fluid dynamics (CFD) has become a very important tool for studying complex flow phenomena. However, in order to obtain reliable results, the numerical methods must be carefully validated.

In this work, we show that the proposed LES framework improves predictive accuracy by 18\% while preserving computational efficiency. The governing equation is
\begin{equation}
    \frac{\partial \rho}{\partial t} + \nabla \cdot (\rho \mathbf{u}) = 0.
\end{equation}

These results provide a lot of useful information for future engineering applications \cite{smith2024}.`;

const changeHandlers = new Set();
const selectionHandlers = new Set();
const scrollHandlers = new Set();
let editorView = null;
let suppressUpdates = false;

function clampPosition(position) {
  const length = editorView?.state.doc.length || 0;
  return Math.max(0, Math.min(Number(position) || 0, length));
}

function createState(doc) {
  return EditorState.create({
    doc,
    extensions: [
      basicSetup,
      StreamLanguage.define(stex),
      highlightSelectionMatches(),
      EditorState.tabSize.of(2),
      EditorView.lineWrapping,
      EditorView.theme({
        '&': { height: '100%' },
        '.cm-scroller': { fontFamily: "'DM Mono', monospace" },
      }),
      EditorView.updateListener.of(update => {
        if (suppressUpdates) return;
        if (update.docChanged) changeHandlers.forEach(handler => handler(update));
        if (update.docChanged || update.selectionSet) selectionHandlers.forEach(handler => handler(update));
      }),
    ],
  });
}

export function initCodeEditor(initialDoc = DEFAULT_DOCUMENT) {
  if (editorView) return editorView;
  els.editor.replaceChildren();
  editorView = new EditorView({
    state: createState(initialDoc),
    parent: els.editor,
  });
  editorView.scrollDOM.addEventListener('scroll', () => {
    scrollHandlers.forEach(handler => handler());
  });
  return editorView;
}

export function onEditorChange(handler) {
  changeHandlers.add(handler);
}

export function onEditorSelectionChange(handler) {
  selectionHandlers.add(handler);
}

export function onEditorScroll(handler) {
  scrollHandlers.add(handler);
}

export function getEditorView() {
  return editorView;
}

export function getValue() {
  return editorView ? editorView.state.doc.toString() : '';
}

export function setValue(value, { resetHistory = true } = {}) {
  if (!editorView) return;
  const doc = String(value || '');
  suppressUpdates = true;
  try {
    if (resetHistory) editorView.setState(createState(doc));
    else editorView.dispatch({ changes: { from: 0, to: editorView.state.doc.length, insert: doc } });
  } finally {
    suppressUpdates = false;
  }
}

export function focusEditor(options = {}) {
  editorView?.focus(options);
}

export function getSelection() {
  if (!editorView) return { start: 0, end: 0, anchor: 0, head: 0, text: '' };
  const range = editorView.state.selection.main;
  const start = Math.min(range.from, range.to);
  const end = Math.max(range.from, range.to);
  return {
    start,
    end,
    anchor: range.anchor,
    head: range.head,
    text: editorView.state.doc.sliceString(start, end),
  };
}

export function getCursorPosition() {
  return getSelection().head;
}

export function getRangeText(start, end) {
  if (!editorView) return '';
  return editorView.state.doc.sliceString(clampPosition(start), clampPosition(end));
}

export function setSelection(start, end = start, { scroll = true, focus = true } = {}) {
  if (!editorView) return;
  const from = clampPosition(start);
  const to = clampPosition(end);
  editorView.dispatch({
    selection: { anchor: from, head: to },
    scrollIntoView: scroll,
  });
  if (focus) focusEditor({ preventScroll: true });
}

export function revealRange(start, end = start) {
  setSelection(start, end, { scroll: true, focus: true });
}

export function replaceRange(start, end, text) {
  if (!editorView) return;
  const from = clampPosition(start);
  const to = clampPosition(end);
  const insert = String(text || '');
  editorView.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + insert.length, head: from + insert.length },
    scrollIntoView: true,
  });
  focusEditor({ preventScroll: true });
}

export function replaceRanges(ranges, replacement) {
  if (!editorView || !ranges?.length) return;
  const changes = ranges
    .map(range => ({ from: clampPosition(range.start), to: clampPosition(range.end), insert: String(replacement || '') }))
    .filter(change => change.from <= change.to)
    .sort((a, b) => a.from - b.from);
  editorView.dispatch({ changes });
}

export function insertText(text) {
  const selection = getSelection();
  replaceRange(selection.start, selection.end, text);
}

export function undoEdit() {
  if (editorView) undo(editorView);
}

export function redoEdit() {
  if (editorView) redo(editorView);
}

export function getLineColumn(position = getCursorPosition()) {
  if (!editorView) return { line: 1, column: 1 };
  const line = editorView.state.doc.lineAt(clampPosition(position));
  return { line: line.number, column: clampPosition(position) - line.from + 1 };
}

export function positionAtLine(lineNumber) {
  if (!editorView) return 0;
  const line = editorView.state.doc.line(Math.max(1, Math.min(Number(lineNumber) || 1, editorView.state.doc.lines)));
  return line.from;
}

export function getScrollState() {
  const selection = getSelection();
  const scrollDOM = editorView?.scrollDOM;
  return {
    scrollTop: scrollDOM?.scrollTop || 0,
    scrollLeft: scrollDOM?.scrollLeft || 0,
    selectionStart: selection.start,
    selectionEnd: selection.end,
  };
}

export function restoreViewState(view = {}) {
  if (!editorView) return;
  const start = clampPosition(view.selectionStart ?? 0);
  const end = clampPosition(view.selectionEnd ?? start);
  setSelection(start, end, { scroll: false, focus: true });
  requestAnimationFrame(() => {
    if (!editorView) return;
    editorView.scrollDOM.scrollTop = view.scrollTop ?? 0;
    editorView.scrollDOM.scrollLeft = view.scrollLeft ?? 0;
  });
}
