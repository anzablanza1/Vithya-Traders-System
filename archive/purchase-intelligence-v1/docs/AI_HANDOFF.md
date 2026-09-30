# AI_HANDOFF.md — for a brand-new AI (V1 frozen, V2 next)

You have **zero access** to the original build chat. Treat these docs as the truth of V1.

## Read in this order
1. `PROJECT_MEMORY.md` — what the system is and what's live.
2. `ARCHITECTURE_CURRENT.md` — data flow, which path is actually used.
3. `SOURCE_OF_TRUTH.md` — where each fact lives.
4. `DATA_MODEL_CURRENT.md` — objects, sheet tabs, storage keys, identifiers.
5. `BUSINESS_RULES_CURRENT.md` — rules (GST/Non-GST, status, dates, allocation, bill logic).
6. `GOOGLE_SHEETS.md`, `SUPABASE_DEPENDENCIES.md`, `API_ENDPOINTS.md` — integration detail.
7. `CURRENT_FEATURES.md`, `KNOWN_ISSUES.md` — state & debt.
8. `DEPLOYMENT.md` — how to deploy/recover.
9. `CHANGE_REGISTER_V1.md` (history) and `CHANGE_REGISTER_V2.md` (the plan going forward).

## Precedence rules
- These CURRENT docs **override** anything in `CHANGE_REGISTER_V1.md` where they conflict (the register
  is chronological history; some early entries are superseded).
- The **frozen source files** override the docs if a doc is ever wrong (verify against code).
- For V2 behaviour, `CHANGE_REGISTER_V2.md` + `BUSINESS_RULES_CURRENT.md` (allocation section) govern.

## Statements that are STALE (do not act on)
- Any "**LIFO**" allocation note → rejected; **FIFO suggestion, editable** is current.
- "Supplier/rate in the PO-Request Goods Check" → removed; **never** put pricing in the request app.
- "History/Fund/Analytics/Goods as top-level nav buttons" → reverted; they are **tabs inside PO Tracking**.
- Older per-lot status/PDF/Excel layouts pre-v8.6 → superseded.
- Browser-side Supabase anon pull → replaced by **server-side** service-role proxy.

## How to verify live behaviour (don't guess)
- Confirm the deployed `/exec` responses before trusting field names (`ping`, `data`, `register`).
- Confirm which product master is authoritative (`Products` tab vs MASTER_ID).
- Confirm the Vasy → Supabase pipeline (cadence/mechanism) — undocumented here.
- Confirm column order in `Lots`/`Lot Lines`/`PO Meta` before any read/write (fixed-index readers).

## Never guess / never break
- **Never** expose supplier, rate, or amount in the PO-Request app.
- **Never** reorder existing sheet columns (breaks fixed-index readers). Add new columns at the end.
- **Never** compute a "final" `lotNo` client-side — the server assigns it.
- **Never** remove `SPLIT_CTX`/`SPLIT_FRESH` guards or the `p.closed` exclusions.
- **Never** commit secret values (tokens, keys, PIN hashes). Only Script-Property **names**.
- **Do not "fix" the one-lot-one-PO limitation in V1** — that's V2's job.

## Mindset for V2
- V1 is an **archive/reference**. Build V2 alongside (new sheet tabs + endpoints), migrate lots→shipments
  read-only first, keep V1 running until V2 is proven. Follow `CHANGE_REGISTER_V2.md` build order
  (V2-01 data model → … → V2-09), shipping/testing each step.
