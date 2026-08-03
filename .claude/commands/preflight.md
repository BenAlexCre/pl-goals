---
description: Pre-flight check before starting any feature — read core docs, check for ISSUE conflicts, identify affected files/APIs/DB objects, then wait for approval
allowed-tools: Read, Glob, Grep
---

# /preflight

This runs before starting any feature.

Example behavior:

Before implementing the requested work:

1. Read CLAUDE.md.
2. Read current-state.md.
3. Read project-board.md.
4. Determine whether the request conflicts with any open ISSUE IDs.
5. Identify affected files.
6. Identify affected APIs.
7. Identify affected database objects.
8. Produce a short implementation plan.
9. Wait for approval before modifying code.
