# PaperCraft AI Workspace Rules

## Product Documentation Is Part of Every Change

- `latex_ai_editor_prd.md` is the source of truth for product scope, behavior, implementation status, limitations, and priorities.
- Every change to code, UI, API behavior, configuration, supported files, startup flow, or user-visible behavior must update `latex_ai_editor_prd.md` in the same task.
- A task that changes project files is not complete until the PRD accurately reflects the result.
- Bug fixes must update the relevant requirement or acceptance criterion and add an entry to the PRD change log.
- New features must update the relevant requirements, current status table, MVP scope, acceptance criteria, and next-stage priorities when applicable.
- Removed or deferred behavior must be explicitly marked in the PRD; do not leave stale claims behind.
- Pure questions or discussions that do not modify project files do not require a PRD edit.

## Architecture Direction

PaperCraft is moving from single-file MVP code toward a layered, feature-oriented architecture.

- Do not add large new features directly into `app.js` or `server.py` when a focused module would keep responsibilities clearer.
- Refactor gradually: preserve current behavior while moving code, and avoid unrelated large migrations.
- Prefer extracting cohesive modules during feature work instead of expanding the existing single files without a clear reason.
- After any extraction or architecture change, run the most relevant checks for the moved behavior.
- If an architecture change affects code, UI, API behavior, configuration, supported files, startup flow, or user-visible behavior, update `latex_ai_editor_prd.md` in the same task.
- Pure workspace-rule changes to this file do not require a PRD edit.

Preferred backend direction:

- `server.py`: startup entry only.
- `papercraft/http_handler.py`: HTTP routing and request dispatch.
- `papercraft/project_io.py`: project import/export, ZIP project creation, and file writeback.
- `papercraft/latex_compile.py`: LaTeX engine detection, compilation, and diagnostics.
- `papercraft/pdf_store.py`: compiled PDF token cache and Range serving.
- `papercraft/model_config.py`: model configuration loading and validation.
- `papercraft/model_clients.py`: OpenAI-compatible, Anthropic, Gemini, and curl transport clients.
- `papercraft/ai_rewrite.py`, `papercraft/ai_feedback.py`, `papercraft/ai_chat.py`: AI workflow modules.
- `papercraft/prompts.py`: system prompts.
- `papercraft/utils.py`: small pure utilities.

Preferred frontend direction:

- `static/app.js`: bootstrap and event wiring.
- `static/state.js`: shared project and editor state.
- `static/db.js`: IndexedDB persistence.
- `static/files.js`: file type detection, import/export, and ZIP project creation.
- `static/editor.js`: editor, selection, line numbers, and scroll state.
- `static/latex_nav.js`: `cite`, `ref`, `input`, and `includegraphics` navigation.
- `static/compile.js`: compile requests and diagnostics.
- `static/pdf_preview.js`: PDF preview, download, and external viewer.
- `static/ai_rewrite.js`, `static/feedback.js`, `static/chat.js`: AI UI workflows.
- `static/layout.js`: resizable layout.

## Verification

- Verify code or configuration changes with the most relevant available checks.
- Before finishing, confirm that implementation and PRD describe the same behavior.
- Report any verification that could not be performed.

## Editing Constraints

- Keep changes scoped to the requested behavior.
- Preserve user-authored files and unrelated changes.
- Never expose model API keys to browser code.
