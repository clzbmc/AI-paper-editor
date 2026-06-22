# PaperCraft AI Workspace Rules

## Product Documentation Is Part of Every Change

- `latex_ai_editor_prd.md` is the source of truth for product scope, behavior, implementation status, limitations, and priorities.
- Every change to code, UI, API behavior, configuration, supported files, startup flow, or user-visible behavior must update `latex_ai_editor_prd.md` in the same task.
- A task that changes project files is not complete until the PRD accurately reflects the result.
- Bug fixes must update the relevant requirement or acceptance criterion and add an entry to the PRD change log.
- New features must update the relevant requirements, current status table, MVP scope, acceptance criteria, and next-stage priorities when applicable.
- Removed or deferred behavior must be explicitly marked in the PRD; do not leave stale claims behind.
- Pure questions or discussions that do not modify project files do not require a PRD edit.

## Verification

- Verify code or configuration changes with the most relevant available checks.
- Before finishing, confirm that implementation and PRD describe the same behavior.
- Report any verification that could not be performed.

## Editing Constraints

- Keep changes scoped to the requested behavior.
- Preserve user-authored files and unrelated changes.
- Never expose model API keys to browser code.
