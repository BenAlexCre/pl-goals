---
description: Comprehensive read-only audit of the Supabase backend — schema, RLS, auth, storage, realtime, edge functions, migrations
allowed-tools: Read, Glob, Grep, Bash
---

# /supabase

Purpose

Perform a comprehensive audit of the Supabase backend without modifying anything.

Scope

Review:

Database schema
Relationships
Constraints
Foreign keys
Indexes
Enum usage
Migrations
RLS policies
Auth integration
Storage
Realtime configuration
Edge Functions
Extensions
Generated columns
Triggers
Functions
Views
Checks
Database Design
Detect duplicated tables
Detect duplicated columns
Identify nullable columns that should be required
Identify missing foreign keys
Identify inconsistent naming
Detect unused tables
Detect unused columns
Detect missing timestamps
Detect missing soft delete strategy
Detect over-normalisation
Detect under-normalisation
Performance
Missing indexes
Redundant indexes
Sequential scans
Inefficient joins
Large text indexes
Missing composite indexes
Unused indexes
Slow query risks
Security
Public tables
Missing RLS
Dangerous service role usage
Exposed RPCs
Anonymous access
Storage permissions
JWT validation
Auth assumptions
Migrations
Drift between schema and migrations
Unsafe migrations
Missing rollback strategy
Duplicate migrations
Migration ordering issues
Output Format
Executive Summary

Critical Issues
High Priority
Medium Priority
Low Priority

Recommended Improvements

Quick Wins (<30 min)

Long Term Improvements

Risk Assessment
