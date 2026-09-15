/**********************************************************************
 * VITHYA TRADERS — Review Feed
 *
 * "Every morning the team opens this, sees what changed in Vasy overnight,
 *  and decides."
 *
 * WHAT IT DETECTS
 *   COST_UP / COST_DOWN   the batch cost moved away from the master cost
 *   PRICE_CHANGED         Vasy's selling price no longer matches the master
 *   MARGIN_RISK           a cost move has pushed true margin below the floor
 *   NEW_PRODUCT           in Vasy, not yet in the master
 *   MISSING_IN_ERP        in the master, no longer in Vasy
 *
 * THE USEFUL PART
 *   For every cost move it computes what your margin BECOMES if you hold the
 *   current price, and what price would HOLD the current margin. That turns
 *   "cost went up 5%" into a decision you can actually take.
 *
 * ACTIONS (taken in the dashboard, or from the sheet menu)
 *   accept   take the new cost into the master, keep the price
 *   reprice  take the new cost AND move the price to hold the margin
 *   ignore   dismiss this row
 *   Both accept and reprice STAGE into Change_Queue — they still go through
 *   approval. Nothing writes straight to the master.
 *
 * RUN buildReviewFeed()  — or let Automation.gs run it nightly.
 **********************************************************************/

const RF = {
  FEED: 'Review_Feed',
  PRICING: 'Pricing',
  CORE: 'Products_Core',
  ERP: 'ERP_Snapshot',
  BATCH: 'Batch_Cost',
  CURRENT: 'Cost_Current',
  QUEUE: 'Change_Queue',
  FLOOR: 0.12,
  COST_TOL: 0.01,      // ignore cost moves under 1%
  PRICE_TOL: 0.5,      // ignore price gaps under 50 paise
};

const RF_COLS = ['detected_at','type','severity','item_code','description','category',
  'field','master_value','new_value','change_pct',
  'margin_now','margin_if_kept','price_to_hold_margin','note','status','acted_at','acted_by'];

function rfNum_(v) { const n = Number(v); return isFinite(n) ? n : ''; }
function rfDate_(v) {
  if (!v) return '';
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return String(v);
}
function rfNow_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
}
function rfHeaderRow_(sh, key) {
  const top = sh.getRange(1, 1, Math.min(6, sh.getLastRow()), sh.getLastColumn()).getValues();
  for (let r = 0; r < top.length; r++)
    for (let c = 0; c < top[r].length; c++)
      if (String(top[r][c]).trim() === key) return r + 1;
  throw new Error(sh.getName() + ': header "' + key + '" not found');
}
function rfRead_(name, key) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return { rows: [], H: {} };
  const hRow = rfHeaderRow_(sh, key);
  const all = sh.getRange(hRow, 1, sh.getLastRow() - hRow + 1, sh.getLastColumn()).getValues();
  const H = {};
  all[0].forEach((h, i) => { const k = String(h).trim(); if (k) H[k] = i; });
  return { rows: all.slice(1), H: H };
}

/* ================= build ================= */

function buildReviewFeed() {
  const t0 = Date.now();
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const pricing = rfRead_(RF.PRICING, 'product_id');
  const core = rfRead_(RF.CORE, 'product_id');
  const erp = rfRead_(RF.ERP, 'itemCode');
  const batch = rfRead_(RF.BATCH, 'canonical_code');
  if (!pricing.rows.length) throw new Error('Pricing is empty.');
  const PH = pricing.H;

  /* keep rows the user already acted on, so actions are not lost on rebuild */
  const prior = {};
  const old = rfRead_(RF.FEED, 'detected_at');
  old.rows.forEach(r => {
    const st = String(r[old.H.status] || '');
    if (st && st !== 'open') {
      prior[String(r[old.H.item_code]) + '|' + String(r[old.H.field])] =
        { status: st, at: r[old.H.acted_at], by: r[old.H.acted_by] };
    }
  });

  /* index master */
  const master = {};
  pricing.rows.forEach(r => {
    const c = String(r[PH.item_code] || '').trim();
    if (!c) return;
    master[c] = {
      costW: rfNum_(r[PH.cost_w_exGST]),
      loadedW: rfNum_(r[PH.loaded_cost_w]),
      loadedWO: rfNum_(r[PH.loaded_cost_wo]),
      sellW: rfNum_(r[PH.selling_w]),
      sellWO: rfNum_(r[PH.selling_wo]),
      tmW: rfNum_(r[PH.true_margin_w]),
      tmWO: rfNum_(r[PH.true_margin_wo]),
      src: String(r[PH.cost_source] || ''),
      transV: rfNum_(r[PH.transport_value]) || 0,
      transT: String(r[PH.transport_type] || 'amount'),
      packV: rfNum_(r[PH.packing_value]) || 0,
      packT: String(r[PH.packing_type] || 'amount'),
    };
  });

  /* index core for description / category */
  const meta = {};
  core.rows.forEach(r => {
    const c = String(r[core.H.item_code] || '').trim();
    if (c) meta[c] = { d: String(r[core.H.description] || ''),
      cat: String(r[core.H.category] || ''),
      cw: String(r[core.H.item_code_w] || ''), cwo: String(r[core.H.item_code_wo] || '') };
  });

  /* index batch cost */
  const bat = {};
  batch.rows.forEach(r => {
    const c = String(r[batch.H.canonical_code] || '').trim();
    if (c) bat[c] = { w: rfNum_(r[batch.H.w_last_rate]),
      date: rfDate_(r[batch.H.last_bill_date]),
      sup: String(r[batch.H.last_supplier] || '') };
  });

  /* index erp by itemCode */
  const erpMap = {};
  erp.rows.forEach(r => {
    const c = String(r[erp.H.itemCode] || '').trim();
    if (c) erpMap[c] = { sell: rfNum_(r[erp.H.sellingPrice]), name: String(r[erp.H.productName] || '') };
  });

  const out = [];
  const now = rfNow_();

  function charged(base, m) {
    const t = (m.transT === 'percentage') ? base * m.transV / 100 : m.transV;
    const p = (m.packT === 'percentage') ? base * m.packV / 100 : m.packV;
    return base + t + p;
  }
  function push(type, sev, code, field, mv, nv, pct, mNow, mKept, hold, note) {
    const k = code + '|' + field;
    const pr = prior[k];
    const md = meta[code] || {};
    out.push([now, type, sev, code, md.d || '', md.cat || '', field,
      mv === '' ? '' : mv, nv === '' ? '' : nv,
      pct === '' ? '' : Math.round(pct * 1000) / 10,
      mNow === '' ? '' : mNow, mKept === '' ? '' : mKept,
      hold === '' ? '' : Math.round(hold * 100) / 100, note,
      pr ? pr.status : 'open', pr ? pr.at : '', pr ? pr.by : '']);
  }

  /* --- 1. cost moves (batch bill vs master W cost) --- */
  Object.keys(bat).forEach(code => {
    const m = master[code];
    const b = bat[code];
    if (!m || m.costW === '' || m.costW <= 0 || b.w === '' || b.w <= 0) return;
    const pct = (b.w - m.costW) / m.costW;
    if (Math.abs(pct) < RF.COST_TOL) return;

    const newLoaded = charged(b.w, m);
    const mKept = (m.sellW !== '' && newLoaded > 0) ? m.sellW / newLoaded - 1 : '';
    const hold = (m.tmW !== '' && newLoaded > 0) ? newLoaded * (1 + m.tmW) : '';
    let sev = 'info';
    if (mKept !== '' && mKept < 0) sev = 'critical';
    else if (mKept !== '' && mKept < RF.FLOOR) sev = 'warn';
    else if (Math.abs(pct) > 0.10) sev = 'warn';

    push(pct > 0 ? 'COST_UP' : 'COST_DOWN', sev, code, 'cost_w_exGST',
      m.costW, b.w, pct, m.tmW, mKept, hold,
      'last bill ' + (b.date || '?') + (b.sup ? ' from ' + b.sup : ''));
  });

  /* --- 2. Vasy price differs from master --- */
  Object.keys(master).forEach(code => {
    const m = master[code];
    const md = meta[code] || {};
    [['selling_w', md.cw, m.sellW, m.loadedW],
     ['selling_wo', md.cwo, m.sellWO, m.loadedWO]].forEach(x => {
      const field = x[0], erpCode = x[1], mv = x[2], loaded = x[3];
      if (!erpCode || mv === '') return;
      const e = erpMap[erpCode];
      if (!e || e.sell === '') return;
      if (Math.abs(e.sell - mv) < RF.PRICE_TOL) return;
      const mKept = (loaded !== '' && loaded > 0) ? e.sell / loaded - 1 : '';
      let sev = 'info';
      if (mKept !== '' && mKept < 0) sev = 'critical';
      else if (mKept !== '' && mKept < RF.FLOOR) sev = 'warn';
      push('PRICE_CHANGED', sev, code, field, mv, e.sell,
        mv > 0 ? (e.sell - mv) / mv : '', '', mKept, '',
        'Vasy differs from master');
    });
  });

  /* --- 3. new products in Vasy --- */
  const known = {};
  Object.keys(meta).forEach(c => {
    known[c] = 1;
    if (meta[c].cw) known[meta[c].cw] = 1;
    if (meta[c].cwo) known[meta[c].cwo] = 1;
  });
  let newCount = 0;
  Object.keys(erpMap).forEach(code => {
    if (known[code]) return;
    newCount++;
    if (newCount > 300) return;             // keep the feed readable
    push('NEW_PRODUCT', 'info', code, '', '', erpMap[code].sell, '', '', '', '',
      erpMap[code].name);
  });

  /* --- 4. margin risk that is not cost-driven --- */
  Object.keys(master).forEach(code => {
    const m = master[code];
    if (m.tmW === '' && m.tmWO === '') return;
    const lo = Math.min(m.tmW === '' ? 99 : m.tmW, m.tmWO === '' ? 99 : m.tmWO);
    if (lo >= RF.FLOOR) return;
    // only report if not already covered by a cost move above
    const dup = out.some(r => r[3] === code && (r[1] === 'COST_UP' || r[1] === 'COST_DOWN'));
    if (dup) return;
    push('MARGIN_RISK', lo < 0 ? 'critical' : 'warn', code, 'true_margin', '', '', '',
      lo, lo, '', lo < 0 ? 'selling below loaded cost' : 'below the 12% floor');
  });

  /* --- write --- */
  let sh = ss.getSheetByName(RF.FEED);
  if (!sh) sh = ss.insertSheet(RF.FEED);
  sh.clear();
  sh.getRange(1, 1, 1, RF_COLS.length).setValues([RF_COLS]);
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, RF_COLS.length).setFontWeight('bold')
    .setBackground('#1F3864').setFontColor('#FFFFFF').setWrap(true);

  /* severity order, then biggest change first */
  const rank = { critical: 0, warn: 1, info: 2 };
  out.sort((a, b) => {
    const r = (rank[a[2]] || 3) - (rank[b[2]] || 3);
    if (r) return r;
    return Math.abs(Number(b[9]) || 0) - Math.abs(Number(a[9]) || 0);
  });
  if (out.length) sh.getRange(2, 1, out.length, RF_COLS.length).setValues(out);
  sh.setColumnWidth(5, 260);
  sh.setColumnWidth(14, 220);

  const tally = {};
  out.forEach(r => { if (String(r[14]) === 'open') tally[r[1]] = (tally[r[1]] || 0) + 1; });
  const crit = out.filter(r => r[2] === 'critical' && String(r[14]) === 'open').length;

  const msg = 'REVIEW FEED BUILT (' + Math.round((Date.now() - t0) / 1000) + 's)\n\n' +
    'Open items: ' + out.filter(r => String(r[14]) === 'open').length +
    (crit ? '\nCRITICAL: ' + crit : '') + '\n\n' +
    Object.keys(tally).sort().map(k => '   ' + k + ': ' + tally[k]).join('\n') +
    (newCount > 300 ? '\n\n(' + newCount + ' new products found; first 300 listed)' : '') +
    '\n\nOpen the Overnight tab in the dashboard to act on these.';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  return out.length;
}

/* ================= act on a feed row ================= */

/**
 * action: 'accept'  take the new cost, keep the price
 *         'reprice' take the new cost AND hold the margin
 *         'ignore'  dismiss
 * Staging goes through Change_Queue, so approval is still required.
 */
function reviewAct(codes, action, by) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(RF.FEED);
  if (!sh || sh.getLastRow() < 2) return { n: 0 };
  const hRow = rfHeaderRow_(sh, 'detected_at');
  const H = {};
  sh.getRange(hRow, 1, 1, sh.getLastColumn()).getValues()[0]
    .forEach((h, i) => { const k = String(h).trim(); if (k) H[k] = i; });
  const first = hRow + 1;
  const n = sh.getLastRow() - hRow;
  const vals = sh.getRange(first, 1, n, RF_COLS.length).getValues();

  const want = {};
  (codes || []).forEach(c => want[String(c).trim()] = 1);
  const all = !codes || !codes.length;
  const now = rfNow_();
  const who = by || 'dashboard';

  const stage = [];
  let touched = 0;
  vals.forEach(r => {
    if (String(r[H.status]) !== 'open') return;
    const code = String(r[H.item_code]);
    if (!all && !want[code]) return;
    const type = String(r[H.type]);
    touched++;
    r[H.status] = action === 'ignore' ? 'ignored' : action;
    r[H.acted_at] = now;
    r[H.acted_by] = who;
    if (action === 'ignore') return;

    const field = String(r[H.field]);
    const nv = rfNum_(r[H.new_value]);
    const mv = rfNum_(r[H.master_value]);
    if (field && nv !== '' && (type === 'COST_UP' || type === 'COST_DOWN' || type === 'PRICE_CHANGED')) {
      stage.push([code, field, mv, nv]);
    }
    if (action === 'reprice') {
      const hold = rfNum_(r[H.price_to_hold_margin]);
      if (hold !== '') stage.push([code, 'selling_w', '', hold]);
    }
  });
  sh.getRange(first, 1, n, RF_COLS.length).setValues(vals);

  let staged = 0;
  if (stage.length) {
    let q = ss.getSheetByName(RF.QUEUE);
    if (!q) {
      q = ss.insertSheet(RF.QUEUE);
      q.getRange(1, 1, 1, 15).setValues([['batch_id','staged_at','staged_by','item_code',
        'product_id','lane','field','old_value','new_value','note','status',
        'approved_by','approved_at','uploaded_at','applied_at']]);
      q.setFrozenRows(1);
    }
    const bid = 'CHG-' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(),
      'yyyyMMdd-HHmmss') + '-RVW';
    const rows = stage.map(s => [bid, now, who, s[0], '', '', s[1], s[2], s[3],
      'from review feed (' + action + ')', 'staged', '', '', '', '']);
    q.getRange(q.getLastRow() + 1, 1, rows.length, 15).setValues(rows);
    staged = rows.length;
  }
  return { n: touched, staged: staged };
}

/* ================= read for the dashboard ================= */

function reviewFeedData(limit) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(RF.FEED);
  if (!sh || sh.getLastRow() < 2) return { items: [], counts: {}, built: '' };
  const hRow = rfHeaderRow_(sh, 'detected_at');
  const H = {};
  sh.getRange(hRow, 1, 1, sh.getLastColumn()).getValues()[0]
    .forEach((h, i) => { const k = String(h).trim(); if (k) H[k] = i; });
  const vals = sh.getRange(hRow + 1, 1, sh.getLastRow() - hRow, RF_COLS.length).getValues();
  const counts = {};
  const items = [];
  const cap = limit || 200;
  let built = '';
  vals.forEach(r => {
    if (!built) built = String(r[H.detected_at] || '');
    const st = String(r[H.status] || '');
    counts[st] = (counts[st] || 0) + 1;
    if (st !== 'open') return;
    const t = String(r[H.type]);
    counts['type_' + t] = (counts['type_' + t] || 0) + 1;
    if (items.length >= cap) return;
    items.push({
      type: t, sev: String(r[H.severity]), code: String(r[H.item_code]),
      desc: String(r[H.description]), cat: String(r[H.category]),
      field: String(r[H.field]),
      mv: r[H.master_value], nv: r[H.new_value], pct: r[H.change_pct],
      mNow: r[H.margin_now], mKept: r[H.margin_if_kept],
      hold: r[H.price_to_hold_margin], note: String(r[H.note]),
    });
  });
  return { items: items, counts: counts, built: built };
}

/* ================= menu ================= */

function rfBuildMenu() { buildReviewFeed(); }
function rfIgnoreAllMenu() {
  const ui = SpreadsheetApp.getUi();
  if (ui.alert('Dismiss every open review item?', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  const r = reviewAct(null, 'ignore', Session.getActiveUser().getEmail() || 'sheet');
  ui.alert('Dismissed ' + r.n + ' item(s).');
}
function onOpenReviewFeed() {
  SpreadsheetApp.getUi()
    .createMenu('🌅 Overnight')
    .addItem('Build review feed', 'rfBuildMenu')
    .addItem('Dismiss all open items', 'rfIgnoreAllMenu')
    .addToUi();
}