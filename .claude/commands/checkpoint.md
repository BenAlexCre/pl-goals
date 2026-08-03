---
description: Checkpoint the session — full project-management pass over docs/project-board.md, current-state.md, session-log.md, and changelog.md, plus a commit message
allowed-tools: Read, Glob, Grep, Edit, Write, Bash
---

# Checkpoint

Perform a project checkpoint.

`/checkpoint` is responsible for project management, not just documentation. It
should always:

Analyse every modification made during this session.

Update current-state.md.

Append to session-log.md.

Update project-board.md.

Update changelog.md.

Mark resolved issue IDs.

Add newly discovered issue IDs.

If required update:

architecture.md

database.md

api.md

decisions.md

features.md

business-rules.md

engineering-principles.md

Remove obsolete information.

Preserve history.

Generate:

Completed work

Outstanding work

Blockers

Technical debt

Risks

Recommended next task

Generate:

Conventional Commit message

One paragraph session summary.

Suggest a Conventional Commit message.

Recommend the single highest-priority next task.

Never overwrite historical session entries.
