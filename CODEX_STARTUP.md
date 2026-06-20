# Codex Startup

This file is the first document Codex must read at the beginning of every session in this repository.

## Purpose

Define the permanent working-memory and session-management sequence for Codex so every session starts from the repository's documented state before making changes.

Canonical project memory lives in `docs/`, except this startup file which stays at the repository root.

## Startup Sequence

1. Read this file first.
2. Read the project memory documents:
   - `docs/CURRENT_STATE.md`
   - `docs/CURRENT_TASK.md`
   - `docs/ACTIVE_MILESTONE.md`
   - `docs/NEXT_STEPS.md`
   - `docs/DECISIONS.md`
   - `docs/CHANGELOG.md`
   - `docs/SESSION_NOTES.md`
   - `docs/PROJECT_HISTORY.md`
   - `docs/ARCHITECTURE.md`
   - `docs/N8N_INTEGRATION.md`
   - `workflows/WORKFLOW_INVENTORY.md`
3. Read `docs/ACTIVE_MILESTONE.md` after `docs/CURRENT_TASK.md`.
4. Read the latest entry in `docs/CHANGELOG.md`.
5. Read `docs/SESSION_NOTES.md` carefully enough to determine:
   - where the previous session stopped
   - what was completed
   - what remains unfinished
   - the exact next task
6. Perform the Repository Health Check.
7. Inspect the repository before making assumptions:
   - relevant source, workflow, data, and documentation files for the task
8. Present the startup summary before editing files.
9. Do not modify files until the startup summary is complete and the user has confirmed the task for the session.
10. Preserve user changes already present in the working tree.

### Startup Recovery

At the beginning of every new session, recover the project state entirely from repository documentation instead of relying on previous chat history.

After reading all project memory files, `docs/ACTIVE_MILESTONE.md`, the latest changelog entry, and `docs/SESSION_NOTES.md`, determine:

- where the previous session stopped
- what was completed
- what remains unfinished
- the exact next task

Summarise this before making any edits.

The startup summary must include the active milestone state:

- current feature
- current milestone
- progress made
- remaining work
- next immediate action

### Repository Health Check

After reading the project memory files, but before making any code changes, perform a repository health check.

Run:

```bash
git status --short --untracked-files=all
git branch --show-current
```

Then include the results in your startup summary.

The startup summary must always contain:

### Repository Status

- Current branch
- Whether the working tree is clean
- Any modified files
- Any untracked files
- Whether there are uncommitted changes that should be reviewed before editing

If the working tree is not clean, ask whether the existing changes should be:

- committed
- stashed
- discarded
- left untouched

Do not assume the correct action. Do not make additional edits until the user has answered.

### Project Summary

- Current platform status
- Current active task
- Recently completed work
- Highest-priority next task
- Files or workflows likely to be modified during this session

### Recommendations

Based on the project documentation and current repository state:

- Recommend the most logical next task.
- Highlight any potential conflicts or unfinished work.
- Warn if multiple changes may overlap.
- Suggest whether documentation should be updated before continuing.

Do not begin editing any files until this startup summary has been presented and the user has confirmed the task for the session.

This repository health check must be performed at the start of every new Codex session.

## End-Of-Session Sequence

Before ending a Codex session, update only the documents that actually changed:

- `docs/CHANGELOG.md` for completed work
- `docs/CURRENT_STATE.md` if platform status changed
- `docs/CURRENT_TASK.md` if the active task changed
- `docs/ACTIVE_MILESTONE.md` with the current live checkpoint
- `docs/NEXT_STEPS.md` if priorities changed
- `docs/DECISIONS.md` if architectural decisions were made
- `docs/SESSION_NOTES.md` with the latest session handoff
- `docs/PROJECT_HISTORY.md` if a high-level milestone changed
- relevant workflow, issue, or architecture docs if the work changed them

Commit documentation updates with the related code changes whenever practical, then push the commits to GitHub when repository access is available.

## Continuous Documentation Updates

Project documentation is the permanent memory of this repository.

Do not wait until the end of a session to update it.

Whenever a meaningful piece of work is completed, immediately update the relevant documentation before continuing.

A meaningful piece of work includes, for example:

- completing a new dashboard component
- completing a workflow
- completing a database schema
- completing a UI redesign section
- completing a bug fix
- completing a refactor
- making an architectural decision
- changing project priorities

For each milestone:

1. Update `docs/CHANGELOG.md`.
2. Update `docs/CURRENT_STATE.md` if platform status changed.
3. Update `docs/CURRENT_TASK.md` if the active task changed.
4. Update `docs/ACTIVE_MILESTONE.md` with the current checkpoint.
5. Update `docs/NEXT_STEPS.md` if priorities changed.
6. Update `docs/DECISIONS.md` if an architectural decision was made.
7. Update `docs/SESSION_NOTES.md` with the current stopping point.
8. Create a Git commit for that milestone.

This should happen throughout long sessions rather than only once at the end.

## Commit Frequency

Avoid extremely large commits.

Prefer multiple logical milestone commits.

Examples:

- Dashboard header redesign complete
- Asset cards redesigned
- Navigation updated
- Backtesting tab scaffold complete

Each milestone should have:

- updated code
- updated documentation
- a Git commit

This ensures that if a Codex session ends unexpectedly, very little project memory is lost.

## Active Milestone

`docs/ACTIVE_MILESTONE.md` is the live checkpoint for the current feature being built.

Unlike `docs/CHANGELOG.md`, which records completed milestones, `docs/ACTIVE_MILESTONE.md` records exactly where development is currently paused.

It should always answer:

> What is Codex working on right now, and what is the very next thing to do?

Keep `docs/ACTIVE_MILESTONE.md` concise and current. It is not a historical record. Once a milestone is completed, move completed details into `docs/CHANGELOG.md` and update `docs/ACTIVE_MILESTONE.md` to the next active piece of work.

Required sections:

- Current Feature
- Current Milestone
- Current Status
- Completed During This Milestone
- Remaining Work
- Current Files Being Modified
- Blockers
- Next Immediate Action
- Last Updated

Current Status must be one of:

- Planning
- In Progress
- Testing
- Complete
- Blocked

`Next Immediate Action` must contain exactly one action and should be the first task performed when work resumes.

Update `docs/ACTIVE_MILESTONE.md`:

- whenever a meaningful milestone is reached
- whenever the current task changes
- whenever work pauses
- before ending every Codex session

Do not update it for trivial edits.

## Milestone Update Rule

For meaningful milestones, update memory immediately instead of waiting until the end of a long session.

Meaningful milestones include:

- dashboard redesigns or new dashboard sections
- new or completed workflows
- database schema changes
- collectors or agents completed
- backtesting UI or engine milestones
- major bug fixes
- architectural decisions

Do not update project memory for trivial edits.

## Working Rules

- Think first.
- Inspect second.
- Plan third.
- Code fourth.
- Validate fifth.
- Document sixth.
- Commit seventh.
- Push eighth.
- Reuse existing implementations wherever possible.
- Never duplicate functionality before checking whether it already exists.
- Prefer extending existing code over replacing it.
- Keep changes as small and isolated as practical.
- Preserve existing functionality unless explicitly instructed otherwise.

## Memory Rules

- Treat the project memory documents as the authoritative source of project context between sessions.
- Inspect existing memory before creating new memory files.
- Preserve existing information unless there is a documented reason to change it.
- Never commit secrets, API keys, or credentials.
- Keep memory updates factual, dated, and scoped to completed or active work.
- `docs/ACTIVE_MILESTONE.md` is the current checkpoint, not a permanent history file.
- `docs/SESSION_NOTES.md` is temporary working memory and should be replaced each session with the most recent handoff.
