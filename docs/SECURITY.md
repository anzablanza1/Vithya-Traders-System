# SECURITY

**This file contains NO actual secrets.** It records only *where* each
credential must be configured, so the system can be operated and rebuilt
without ever putting a secret in the repository.

**Rule: no real keys, tokens, or passwords in Git, ever.** If a secret is
found in the repo history, treat it as compromised and rotate it.

---

## The credentials in play

| credential | what it is | where it must be configured | must NOT be |
|---|---|---|---|
| **Supabase `service_role` key** | full DB access, bypasses RLS | (1) Apps Script → Project Settings → **Script Properties**, key `SUPABASE_SERVICE_KEY`; (2) Hostinger file `/home/u631621082/supabase_key.txt` (**outside** the web root) | in any HTML file, any browser, any committed file |
| **Supabase URL** | the project REST base | Apps Script Script Property `SUPABASE_URL`; hard-coded in `supabase.php` | — (not secret, but keep with the key) |
| **Supabase `anon` / publishable key** | browser-safe key, gated by RLS | **not currently used** — no dashboard holds it | put in a browser *unless* RLS SELECT policies exist first |
| **Vasy API token** | `api-token` header for the Vasy API | Apps Script Script Property `VASY_API_TOKEN` | in any HTML or committed file |
| **Vasy base URL / branch** | API base + branch id | Script Properties `VASY_BASE_URL`, `VASY_BRANCH_ID` | — |
| **PHP `RUN_TOKEN`** | guards `supabase.php` from web triggering | inside `supabase.php` on Hostinger (`$RUN_TOKEN`) | left at the default `change-me-...`; committed to Git |
| **Hostinger login / FTP creds** | server + FTP access | Hostinger control panel / the owner's password manager | in the repo |
| **Vasy login** | ERP access | the owner's password manager | in the repo |
| **Google account** | owns Apps Script, Sheets, deployments | the owner's Google account | shared or committed |
| **Google Sheet / workbook IDs** | identify the data workbooks | Apps Script Script Properties (e.g. `*_ID`) | — (not secret, but keep out of public docs) |

---

## How the service key stays out of browsers

Every Supabase-backed dashboard (recon, inventory) talks to an **Apps Script
proxy**, which holds the service key in Script Properties and queries Supabase
server-side. The browser only ever sees the returned JSON. This is the whole
reason those screens go through Apps Script instead of calling Supabase
directly. **Never refactor a dashboard to call Supabase directly with the
service key.**

---

## RLS posture

- RLS is **ON** for every table, with **zero policies**. Net effect: the
  service key has full access; the `anon` key has none. Safe **only because**
  no browser holds the service key.
- Supabase's linter flags every view "Security Definer — CRITICAL". Not
  currently reachable (anon unused). If the anon key is ever introduced,
  recreate views with `security_invoker = true` and add explicit RLS SELECT
  policies **before** exposing it.

---

## Known history

- An earlier Supabase service key was shared in the clear and **rotated**. The
  Hostinger key file and the Apps Script property were updated to the new key.
- The PHP `RUN_TOKEN` was changed from its default to a non-default value.
- **VERIFY** periodically that no secret has crept into any committed file,
  any HTML dashboard, or any Google Sheet cell.

---

## For whoever sets up the GitHub repo

- Add a `.gitignore` that excludes any file that could hold a secret (e.g. a
  real `supabase.php` with the key inline, any `.env`, any exported Script
  Properties).
- Commit a **`supabase.php.example`** with the key line blanked
  (`$SUPABASE_KEY = "SET_ON_SERVER";`) — never the real file.
- Document the Script Property names (done here) but never their values.
- If using GitHub Actions or any CI later, put secrets in the platform's
  secret store, not the repo.


---

## 2026-10-03 legacy/pre-V2 Edge Function finding

The System V1 freeze audit found one live Supabase Edge Function named
`pp-planner-list` created during earlier Purchase/Inventory experimentation.

The live source had JWT verification disabled and contained a hard-coded access
token. The token value is intentionally not stored in Git. A sanitized source
copy is preserved under:

`supabase/pre-v2-scaffolding/edge-functions/pp-planner-list/index.ts`

Treat the old token as exposed/legacy security debt and do not reuse this
authentication pattern in Platform V2.
