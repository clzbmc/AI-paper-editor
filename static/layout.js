import { clamp, els, state } from './state.js?v=20260625-codemirror-editor';

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

export function makeResizable(resizer, { onStart, onMove, onFinish }) {
  resizer.addEventListener('pointerdown', event => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startState = onStart();
    resizer.classList.add('dragging');
    document.body.classList.add('resizing');
    const move = moveEvent => {
      moveEvent.preventDefault();
      onMove(moveEvent.clientX - startX, startState);
    };
    const finish = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      resizer.classList.remove('dragging');
      document.body.classList.remove('resizing');
      onFinish(startState);
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', finish, { once: true });
    window.addEventListener('pointercancel', finish, { once: true });
  });
}

export function setupResizableLayout() {
  applyLayout();
  makeResizable(document.querySelector('#editor-resizer'), {
    onStart: () => ({
      total: els.workspace.clientWidth,
      editorWidth: els.editorPane.getBoundingClientRect().width,
      controlWidth: els.controlPane.getBoundingClientRect().width,
    }),
    onMove: (delta, start) => {
      state.layout.editor = clamp(start.editorWidth + delta, 380, start.total - start.controlWidth - 312);
      els.workspace.style.gridTemplateColumns = `${state.layout.editor}px 6px ${start.controlWidth}px 6px minmax(300px, 1fr)`;
    },
    onFinish: start => {
      state.layout.control = start.controlWidth;
      persistLayout();
    },
  });

  makeResizable(document.querySelector('#control-resizer'), {
    onStart: () => ({
      total: els.workspace.clientWidth,
      editorWidth: els.editorPane.getBoundingClientRect().width,
      controlWidth: els.controlPane.getBoundingClientRect().width,
    }),
    onMove: (delta, start) => {
      state.layout.control = clamp(start.controlWidth + delta, 230, start.total - start.editorWidth - 312);
      els.workspace.style.gridTemplateColumns = `${start.editorWidth}px 6px ${state.layout.control}px 6px minmax(300px, 1fr)`;
    },
    onFinish: start => {
      state.layout.editor = start.editorWidth;
      persistLayout();
    },
  });

  makeResizable(document.querySelector('#tree-resizer'), {
    onStart: () => ({
      treeWidth: document.querySelector('#project-tree').getBoundingClientRect().width,
      editorPaneWidth: els.editorPane.clientWidth,
    }),
    onMove: (delta, start) => {
      state.layout.tree = clamp(start.treeWidth + delta, 115, start.editorPaneWidth - 260);
      els.editorBody.style.gridTemplateColumns = `${state.layout.tree}px 5px minmax(0, 1fr)`;
    },
    onFinish: persistLayout,
  });
}
