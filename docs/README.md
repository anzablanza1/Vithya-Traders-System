# Vithya Traders — System Knowledge Base

## Active Purchase Intelligence V2

Purchase Intelligence V2 is now active on branch `v2-development`.

A brand-new AI or developer working on Purchase Intelligence must begin at the repository root `AGENTS.md`, then read `docs/v2/START_HERE.md`. The active V2 state, current work, roadmap, decisions, tests and work-item specifications live under `docs/v2/`.

`archive/purchase-intelligence-v1/` is an immutable historical V1 snapshot and must not be edited. Where archived V1 docs still contain an unresolved note that is later resolved by `docs/PURCHASE_V1_FREEZE_VERIFICATION.md`, use the newer verified record.

The system-wide documentation below remains useful background for the wider Vithya Traders platform, but it is not the active Purchase V2 handoff.

**Version 1 · handover snapshot · 11 September 2026**

This folder is the permanent, AI-readable record of the Vithya Traders data
system. It exists so the system no longer depends on any single chat
conversation as its memory.

**Treat the system running today as VERSION 1. Preserve it. Do not redesign
or modify the live system on the basis of these documents alone — read
`AI_INSTRUCTIONS.md` first.**

---

## How to read this

Start with `PROJECT_CONTEXT.md`. Then, depending on what you need:

| file | what it covers |
|---|---|
| `PROJECT_CONTEXT.md` | what the business is, what the system does, current status |
| `ARCHITECTURE.md` | the full data flow, every component, dependencies |
| `DATA_DICTIONARY.md` | every Supabase table and view, columns, meaning, data quality |
| `BUSINESS_RULES.md` | every rule the numbers depend on (lanes, GST, backfill, margin) |
| `DASHBOARDS.md` | every screen — purpose, data source, filters, limitations |
| `ERP_INTEGRATION.md` | Vasy API and FTP, schedules, failure handling |
| `SUPABASE.md` | the database — tables, views, ingestion, security |
| `APPS_SCRIPT.md` | every script file, triggers, web apps, the token mechanism |
| `DEPLOYMENT.md` | how dashboards are deployed and changed today |
| `DECISIONS.md` | why the system is built the way it is |
| `CHANGELOG.md` | the important changes and corrections, reconstructed |
| `KNOWN_ISSUES.md` | bugs, unreliable data, technical debt, things to verify |
| `TODO.md` | pending work |
| `SECURITY.md` | where credentials live (not the credentials themselves) |
| `AI_INSTRUCTIONS.md` | **required reading for any AI touching this repo** |
| `FILES_TO_COLLECT.md` | checklist of source files still needed for a complete repo |

---

## A note on confidence

This knowledge base was reconstructed from the live Supabase database (read
directly, not from memory) and from the working files produced across many
build sessions. Where a fact is verified against the live database it is
stated plainly. Where it is remembered from conversation and not
independently checked, it is marked **VERIFY** or **UNKNOWN**.

The live database was queried on 11 September 2026 to build the data
dictionary, so those table and view names, row counts and column lists are
accurate as of that date.

---

## The owner is a non-coder

The person who owns this system does not write code. Every explanation that
reaches them must be in plain language. See `AI_INSTRUCTIONS.md`.
