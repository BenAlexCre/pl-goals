---
description: Complete Row Level Security audit of every table, including policy vulnerabilities and rewrites (read-only)
allowed-tools: Read, Glob, Grep, Bash
---

# /rls

Purpose

Perform a complete Row Level Security audit.

Review every table.

For each table report:

Table Name

RLS Enabled?
Policies Present?
Policies Missing?
Authenticated Access
Anonymous Access
Service Role Access

Potential Vulnerabilities

Recommended Policy
Detect

Circular dependencies

Policies referencing tables that depend on each other.

Recursive EXISTS queries.

Infinite recursion risks.

Duplicate policies.

Policies that never evaluate TRUE.

Policies that can never be reached.

Policies allowing:

USING (true)

where inappropriate.

Policies relying on client-side trust.

Missing WITH CHECK clauses.

INSERT without validation.

DELETE without ownership checks.

UPDATE privilege escalation.

Auth.uid() misuse.

Auth.jwt() misuse.

Storage policy inconsistencies.

Also evaluate

Least privilege

Multi-tenant isolation

Owner-only access

Admin access

Invite workflows

Organisation-based permissions

Finish with
Overall Security Rating

Critical Vulnerabilities

Suggested Policy Rewrites
