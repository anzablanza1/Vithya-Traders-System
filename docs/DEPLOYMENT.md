# DEPLOYMENT

How the system is deployed and changed **today** (Version 1). This is the
as-is reality, not an ideal. The owner is a non-coder and makes changes by
pasting.

---

## Where things live

| thing | lives | how it is edited |
|---|---|---|
| Apps Script code (`.gs`) | one Apps Script project bound to a Google Sheet | paste into the online editor, file by file |
| Dashboard HTML | (a) as files in the Apps Script project **and/or** (b) downloaded HTML the owner opens locally / hosts | paste new HTML, redeploy; or open the local file |
| Supabase tables/views | Supabase project `kssydapdfmkfufrqhwzp` | SQL migrations run from the Supabase SQL editor |
| FTP loader (`supabase.php`) | Hostinger, home dir `/home/u631621082/` | edit the file on Hostinger; runs by cron |
| Supabase service key | Hostinger `/home/u631621082/supabase_key.txt` (outside web root) and Apps Script Script Properties | edit both when rotated |
| Google Sheets data | several workbooks (see ARCHITECTURE) | written by Apps Script |
| Sheet/workbook IDs, Vasy token | Apps Script Script Properties | set in the editor |

---

## How a dashboard connects to its data

Two patterns:

**A. JSONP to an Apps Script web app (floor, office, pricing)**
1. The HTML calls the `/exec` URL with `?app=floor&action=...&callback=cb`.
2. The web app reads the Google Sheets read model and returns
   `cb({...json...})`.
3. The HTML renders it. All filtering/sorting is local after the first fetch.

**B. JSONP to an Apps Script proxy that reads Supabase (recon, inventory)**
1. The HTML has a **connect box** where the owner pastes the `/exec` URL
   (stored in `localStorage`).
2. The HTML calls `?app=recon&action=rows&callback=cb`.
3. The Apps Script proxy queries Supabase with the **service key
   (server-side)** and returns JSON. The browser never sees the key.

---

## How to make a change (the actual current process)

**Change Apps Script logic:**
1. Open the Apps Script editor.
2. Paste the updated `.gs` file (select all, paste — do not append).
3. Save.
4. If a **web app** serves the affected screen: **Deploy → Manage deployments
   → edit → New version → Deploy.** (Triggers need no redeploy.)
5. Run `whatIsLive()` to confirm the new version is the live one and no old
   file is shadowing it.

**Change a dashboard's look/behaviour:**
1. Paste the new HTML (as the project file of the same name, or replace the
   local/hosted file).
2. Redeploy the web app if it serves the HTML.
3. Hard-refresh the browser (Ctrl/Cmd+Shift+R).

**Change the database:**
1. Run the SQL migration in the Supabase SQL editor.
2. Views are `create or replace`; tables via `alter`/`create`.

**Change the FTP loader:**
1. Edit `supabase.php` on Hostinger.
2. It runs on the next cron; can be triggered manually with the `RUN_TOKEN`.

---

## Deployment gotchas (learned)

- **`/a/macros/` URLs need a Google login** the HTML cannot provide. Deploy
  with **Access: Anyone** and use the URL without `/a/macros/`.
- **Editing code ≠ deploying it.** The `/exec` URL keeps serving the old
  version until you cut a new version.
- **One broken `.gs` file stops the whole project from listing functions** —
  if the Run dropdown is empty, a file failed to parse; the editor names it.
- **Duplicate function names silently shadow.** `whatIsLive()` catches it.
- **The Run dropdown only lists zero-argument functions** — argument-taking
  functions need a no-arg wrapper to run from the menu.

---

## Not yet in place (see FILES_TO_COLLECT.md and TODO.md)

- **No Git repository yet.** This knowledge base is step one; collecting the
  actual source files into GitHub is step two.
- No automated deploy; everything is manual paste + redeploy.
- No staging environment; changes go straight to the live project (mitigated
  by the guards and by `whatIsLive()`).
