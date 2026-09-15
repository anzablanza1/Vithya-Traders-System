/**********************************************************************
 * VITHYA TRADERS — CONNECTION DIAGNOSTIC
 *
 * Globals declared here (check before pasting):
 *   connectionDiagnose, showAllTokens
 *
 * READ ONLY. Run this when a dashboard will not connect.
 *
 * There are five things that must all be true, and the browser cannot tell
 * you which one failed — every failure looks the same from the outside.
 * This checks them one at a time and names the culprit.
 **********************************************************************/

function connectionDiagnose() {
  const p = PropertiesService.getScriptProperties();
  const out = [];
  let fatal = 0;

  /* 1. are the entry points present at all */
  const entries = [
    ['doGet', 'pricing', 'DashboardAPI_v2.gs'],
    ['doGetOffice', 'office', 'OfficeAPI.gs'],
    ['doGetFloor', 'floor', 'FloorAPI.gs'],
  ];
  out.push('── 1. entry points ──');
  entries.forEach(function (e) {
    let ok = false;
    try { ok = (typeof this[e[0]] === 'function'); } catch (x) {}
    if (!ok) {
      try { ok = eval('typeof ' + e[0]) === 'function'; } catch (x) { ok = false; }
    }
    out.push('   ' + (ok ? 'OK  ' : 'MISSING  ') + e[0] + '   (' + e[2] + ')');
    if (!ok) fatal++;
  });

  /* 2. does the shared doGet actually route */
  out.push('');
  out.push('── 2. routing ──');
  let routed = { office: false, floor: false };
  try {
    const src = String(doGet);
    routed.office = src.indexOf("'office'") >= 0;
    routed.floor = src.indexOf("'floor'") >= 0;
    out.push('   ' + (routed.office ? 'OK  ' : 'MISSING  ') + '?app=office branch');
    out.push('   ' + (routed.floor ? 'OK  ' : 'MISSING  ') + '?app=floor branch');
    if (!routed.office || !routed.floor) {
      fatal++;
      out.push('   -> DashboardAPI_v2.gs is an older copy. Replace it.');
    }
  } catch (e) {
    out.push('   could not inspect doGet: ' + e.message);
    fatal++;
  }

  /* 3. tokens */
  out.push('');
  out.push('── 3. tokens ──');
  [['VT_DASH_TOKEN', 'pricing'], ['VT_OFFICE_TOKEN', 'office'],
   ['VT_FLOOR_TOKEN', 'floor']].forEach(function (t) {
    const v = p.getProperty(t[0]);
    out.push('   ' + (v ? 'OK  ' : 'NOT SET  ') + t[0] +
      (v ? '   ' + v.slice(0, 18) + '…' : '   -> run ' +
        (t[1] === 'office' ? 'ofcSetup()' : t[1] === 'floor' ? 'flrSetup()' : 'apSetup()')));
    if (!v) fatal++;
  });

  /* 4. can each API actually read its data */
  out.push('');
  out.push('── 4. data ──');
  const checks = [
    ['office', function () { const d = ofcInit_(); return d.count + ' products'; }],
    ['floor', function () { const d = flrInit_(); return d.count + ' products, ' +
      d.in_stock + ' in stock'; }],
  ];
  checks.forEach(function (c) {
    try { out.push('   OK  ' + c[0] + ': ' + c[1]()); }
    catch (e) { out.push('   FAILS  ' + c[0] + ': ' + e.message); fatal++; }
  });

  /* 5. the deployment */
  out.push('');
  out.push('── 5. deployment ──');
  let url = '';
  try { url = ScriptApp.getService().getUrl(); } catch (e) {}
  if (url) {
    out.push('   ' + url);
    out.push('   the dashboards need the /exec URL, NOT /dev');
    if (url.indexOf('/dev') > 0) {
      out.push('   -> this is the /dev URL. Deploy > Manage deployments > copy the /exec one.');
    }
  } else {
    out.push('   NOT DEPLOYED — Deploy > New deployment > Web app');
    fatal++;
  }
  out.push('   After ANY code change: Deploy > Manage deployments > pencil >');
  out.push('   New version > Deploy. Editing code alone does not update the URL.');

  const msg = 'CONNECTION DIAGNOSTIC\n\n' + out.join('\n') + '\n\n' +
    (fatal ? fatal + ' problem(s) found — fix from the top down.'
           : 'Everything checks out. If a dashboard still fails, the URL or ' +
             'token pasted into it is wrong: click the gear icon and re-enter both.');
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg.slice(0, 1400)); } catch (e) {}
  return fatal;
}

/** all three URLs and tokens in one place, to paste into the dashboards */
function showAllTokens() {
  const p = PropertiesService.getScriptProperties();
  let url = '';
  try { url = ScriptApp.getService().getUrl(); } catch (e) {}
  const msg = 'DASHBOARD CONNECTION DETAILS\n\n' +
    'URL (the same for all three):\n' + (url || '(not deployed)') + '\n\n' +
    'pricing token:\n' + (p.getProperty('VT_DASH_TOKEN') || '(not set)') + '\n\n' +
    'office token:\n' + (p.getProperty('VT_OFFICE_TOKEN') || '(not set — run ofcSetup)') + '\n\n' +
    'floor token:\n' + (p.getProperty('VT_FLOOR_TOKEN') || '(not set — run flrSetup)') + '\n\n' +
    'One deployment serves all three; the ?app= parameter and the token\n' +
    'together decide what a caller can see.';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
}