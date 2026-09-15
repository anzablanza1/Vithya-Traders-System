# AI_INSTRUCTIONS

**Read this before doing anything to this repository or the live system.**

You are working on a live business system that a real company depends on
daily. The owner is a **non-coder**. Getting something subtly wrong here means
wrong money figures on a screen someone trusts. Caution is the job.

---

## The non-negotiables

1. **Investigate before you change.** Read the relevant KB files, then read
   the actual source, then check the live system. Never act on the KB alone —
   it can be out of date. When it disagrees with the live system, the live
   system wins, and you update the KB.

2. **Never invent a database column, table, view, endpoint, or business
   rule.** If you are not certain a column exists, query the live database (or
   ask) — do not assume. Guessed field names and API constants have been the
   single biggest source of wasted effort on this project. The correct values
   are almost always already in the working code — **read the working caller
   first.**

3. **Preserve working behaviour.** Do not "improve", refactor, rename, or
   restructure anything that works unless the owner explicitly asked for that
   change. A change that leaves the output identical was not worth the risk.

4. **Respect the rules in `BUSINESS_RULES.md` absolutely.** The lane rule,
   `sales_data` being untouchable, Vasy `balance` as receivables truth,
   landing cost being a line total, the floor showing no cost — breaking any
   of these produces plausible, wrong numbers. Re-read that file when in doubt.

5. **Verify, don't trust, when it comes to "is it live".** Apps Script
   silently shadows duplicate function names. After any `.gs` change, the fix
   is not confirmed until `whatIsLive()` says so. Editing code does not deploy
   it — a web app needs a new version.

6. **Document significant changes.** Update `CHANGELOG.md` (what changed and
   why), and any KB file the change affects (`DATA_DICTIONARY.md` for a new
   column/view, `KNOWN_ISSUES.md` if you found or fixed a bug, etc.). A change
   the next AI cannot see is a trap you set for it.

7. **Use version history so anything can be reverted.** Commit to Git before
   and after a change, with a clear message. Never make a large irreversible
   change without a way back. For the database, keep the migration SQL.

8. **Never put a secret in the repo.** See `SECURITY.md`. No keys, tokens, or
   passwords in any committed file, HTML, or Sheet.

9. **Explain everything to the owner in plain language.** They do not read
   code. Tell them: what you are about to do, which file to paste, whether a
   redeploy is needed, and how they will know it worked. One thing at a time,
   in order.

---

## How to make a change safely (the standard loop)

1. **Understand the ask** in the owner's words; restate it plainly.
2. **Read** the relevant KB file(s) and the actual source file(s).
3. **Check the live system** — query Supabase, run `whatIsLive()`, look at the
   real data. Confirm the KB still matches reality; note any drift.
4. **Make the smallest change** that satisfies the ask. Do not touch anything
   adjacent.
5. **Validate**: parse/syntax-check code; for a dashboard, render-test it; for
   SQL, run it and check a known total still ties (see the health check
   below); confirm no function-name clash across `.gs` files.
6. **Give the owner exact steps**: which file to replace, whether to redeploy,
   what to run to confirm.
7. **Document**: update `CHANGELOG.md` and any affected KB file; commit.

---

## The health check (run after any sales/view change)

These two totals must be equal. If they diverge, a view was repointed or a
source is double-counting — stop and find out why before proceeding.

```sql
select (select round(sum(net_value))     from v_agg_sales_daily) agg,
       (select round(sum(net_amount_num)) from v_sales_all)      base;
```

---

## Specific traps this project has already fallen into

- Guessing Vasy API constants (page size, date format, list key, path,
  field names) → **read the working caller.**
- Treating `landing_cost` as per-unit → it is a **line total**.
- Reading `v_sales` (FTP only) instead of `v_sales_all` → **95% of the data
  missing**, silently.
- `overflow:hidden` on a table → **sticky header dies.**
- Not routing a new `?app=` before the token check → **"Bad token".**
- Editing a `.gs` file and assuming it is live → **run `whatIsLive()`.**
- A `CASCADE` drop taking dependent views with it → **check dependencies
  before dropping.**
- Copying stale sheets as a "failover" → the sheets stop when the pull stops;
  **pull from the API.**

---

## What you must NOT do without explicit owner instruction

- Redesign or re-architect anything (Version 1 is to be preserved).
- Restart the parked work (product master, price manager, PO-in-Supabase).
- Delete any `.gs` file, table, or view "to tidy up".
- Write to `sales_data` from anything but the FTP pipeline.
- Put the anon key in a browser, or the service key anywhere a browser sees it.
- Change how the owner deploys (manual paste) into something they cannot
  operate.

---

## When you are unsure

Say so, in plain language, and ask. A withheld change is cheap; a wrong change
to a live financial system is not. "I'm not certain this column exists / this
is still live / this won't change the numbers — let me check / can you
confirm" is always the right move.
