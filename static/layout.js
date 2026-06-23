import { clamp, els, state } from './state.js';
import { scheduleLineNumbers } from './editor.js';

export function persistLayout() {
  localStorage.setItem('papercraft-layout', JSON.stringify(state.layout));
}

export function applyLayout() {
  const total = els.workspace.clientWidth;
  if (state.layout.editor || state.layout.control) {
    const editorWidth = clamp(state.layout.editor || els.editorPane.getBoundingClientRect().width, 380, total - 548);
    const controlWidth = clamp(state.layout.control || els.controlPane.getBoundingClientRect().width, 230, total - editorWidth - 312);
    state.layout.editor = editorWidth;
    state.layout.control = controlWidth;
    els.workspace.style.gridTemplateColumns = `${editorWidth}px 6px ${controlWidth}px 6px minmax(300px, 1fr)`;
  }
  if (state.layout.tree) {
    state.layout.tree = clamp(state.layout.tree, 115, Math.max(115, els.editorPane.clientWidth - 260));
    els.editorBody.style.gridTemplateColumns = `${state.layout.tree}px 5px minmax(0, 1fr)`;
  }
}

export function makeResizable(resizer, onMove, onFinish) {
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

export function setupResizableLayout() {
  applyLayout();
  makeResizable(document.querySelector('#editor-resizer'), delta => {
    const total = els.workspace.clientWidth;
    const controlWidth = els.controlPane.getBoundingClientRect().width;
    state.layout.editor = clamp((state.layout.dragEditorStart ?? els.editorPane.getBoundingClientRect().width) + delta, 380, total - controlWidth - 312);
    els.workspace.style.gridTemplateColumns = `${state.layout.editor}px 6px ${controlWidth}px 6px minmax(300px, 1fr)`;
  }, () => { delete state.layout.dragEditorStart; state.layout.control = els.controlPane.getBoundingClientRect().width; persistLayout(); });
  document.querySelector('#editor-resizer').addEventListener('pointerdown', () => { state.layout.dragEditorStart = els.editorPane.getBoundingClientRect().width; });

  makeResizable(document.querySelector('#control-resizer'), delta => {
    const total = els.workspace.clientWidth;
    const editorWidth = els.editorPane.getBoundingClientRect().width;
    state.layout.control = clamp((state.layout.dragControlStart ?? els.controlPane.getBoundingClientRect().width) + delta, 230, total - editorWidth - 312);
    els.workspace.style.gridTemplateColumns = `${editorWidth}px 6px ${state.layout.control}px 6px minmax(300px, 1fr)`;
  }, () => { delete state.layout.dragControlStart; state.layout.editor = els.editorPane.getBoundingClientRect().width; persistLayout(); });
  document.querySelector('#control-resizer').addEventListener('pointerdown', () => { state.layout.dragControlStart = els.controlPane.getBoundingClientRect().width; });

  makeResizable(document.querySelector('#tree-resizer'), delta => {
    state.layout.tree = clamp((state.layout.dragTreeStart ?? document.querySelector('#project-tree').getBoundingClientRect().width) + delta, 115, els.editorPane.clientWidth - 260);
    els.editorBody.style.gridTemplateColumns = `${state.layout.tree}px 5px minmax(0, 1fr)`;
  }, () => { delete state.layout.dragTreeStart; persistLayout(); });
  document.querySelector('#tree-resizer').addEventListener('pointerdown', () => { state.layout.dragTreeStart = document.querySelector('#project-tree').getBoundingClientRect().width; });
}
