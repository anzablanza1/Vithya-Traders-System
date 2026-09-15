/**********************************************************************
 * VITHYA TRADERS — DATA CATALOGUE
 *
 * Globals declared here (check before pasting):
 *   CAT, CAT_DEFS, CAT_COLS, buildDataCatalog, catalogJson, catalogAudit,
 *   catFind_, onOpenCatalog
 *
 * ── WHAT THIS ANSWERS ──
 *   "Which sheets come from Vasy, and which do we actually work in?"
 *
 *   Four classes, and the distinction is the point:
 *
 *   LEGACY     superseded but still present. Either still driving something
 *              (and so a second source of truth) or simply dead. Retire.
 *   RAW        pulled from the Vasy API. Overwritten by the next pull.
 *              NEVER hand-edit — your edit disappears tonight.
 *   WORKABLE   you own it. Nothing overwrites it. This is where decisions live.
 *   COMPUTED   rebuilt from RAW + WORKABLE on a schedule. Deleting one costs a
 *              re-run, not data.
 *   CONFIG     settings and rules you set once and rarely change.
 *
 * ── WHY IT MATTERS FOR RAG ──
 *   A retrieval layer pointed at everything will happily quote a stale
 *   COMPUTED table or an unverified RAW cost as though it were fact.
 *   catalogJson() emits a machine-readable manifest — class, source, refresh
 *   schedule, grain, and a plain description of what each sheet means — so
 *   the retriever knows what it is reading and what it can be trusted for.
 *
 * ── RUN ──
 *   buildDataCatalog()   write the Data_Catalog tab
 *   catalogAudit()       find sheets not in the catalogue, and vice versa
 *   catalogJson()        the manifest, for RAG or documentation
 **********************************************************************/

const CAT = { SHEET: 'Data_Catalog' };

const CAT_COLS = ['sheet', 'workbook', 'class', 'source', 'refresh', 'grain',
  'key', 'rows', 'editable', 'description'];

/**
 * class     raw | workable | computed | config
 * source    the Vasy endpoint, the upstream sheet, or 'you'
 * editable  yes = safe to change by hand; no = it will be overwritten
 */
const CAT_DEFS = [
  /* ── RAW: straight from Vasy, overwritten by the next pull ── */
  { sheet: 'ERP_Snapshot', cls: 'raw', src: 'GET /product/products-inventory',
    refresh: 'nightly 01:00', grain: 'one row per Vasy SKU (W and WO separate)',
    key: 'itemCode',
    desc: 'Product master as Vasy holds it: name, category, brand, tax, MRP, ' +
      'selling price, current quantity. NO COST — Vasy does not expose cost here.' },
  { sheet: 'Cost_Current', cls: 'raw', src: 'GET /product/details',
    refresh: 'nightly 04:00, resumable sweep', grain: 'one row per SKU',
    key: 'itemCode',
    desc: 'Latest purchase price and landing cost per SKU. The gap between ' +
      'the two is transport absorbed into cost — the problem the verified ' +
      'pricing layer exists to fix.' },
  { sheet: 'Purchase_Register', cls: 'raw', src: 'POST /report/purchase-item-register',
    refresh: 'nightly 02:00', grain: 'one row per purchase bill line',
    key: 'billNo + itemCode',
    desc: 'Every purchase line. Rates here are frequently wrong — often ' +
      'transport-inclusive or entered to make a bill save. Treat as evidence, ' +
      'not truth.' },
  { sheet: 'Sales_Items_YYYY', cls: 'raw', src: 'POST /report/sales-item-register/invoice',
    refresh: 'nightly 06:00, rolling 7-day window', grain: 'one row per invoice line',
    key: 'salesNo + itemCode + batchNo',
    desc: 'Every sales line, split into one workbook per financial year. ' +
      'Carries qty, selling price, landing cost and profit as Vasy computed them.' },
  { sheet: 'Sales_Invoices_YYYY', cls: 'raw', src: 'POST /api/v1/sales/get-all-sales-orders',
    refresh: 'nightly 05:30, rolling 7-day window', grain: 'one row per invoice',
    key: 'salesId',
    desc: 'Invoice headers with total, paidAmount and dueDate. balance = ' +
      'total - paidAmount is the basis of invoice-level outstanding.' },

  /* ── WORKABLE: you own these ── */
  { sheet: 'Verified_Pricing', cls: 'workable', src: 'you',
    refresh: 'never overwritten', grain: 'two rows per product (W and WO)',
    key: 'item_code + lane',
    desc: 'THE SOURCE OF TRUTH FOR PRICING. Cost, transport, packing and ' +
      'selling that you stand behind, each with its own trust state: ' +
      'verified, guessed, book, unverified or stale. Everything downstream ' +
      'is only as reliable as the trust marks here.' },
  { sheet: 'Products_Core', cls: 'workable', src: 'derived once, then yours',
    refresh: 'on demand', grain: 'one row per canonical product',
    key: 'item_code',
    desc: 'The canonical product list: one row per physical product, mapping ' +
      'its W and WO Vasy codes. The join key for the whole system.' },
  { sheet: 'Media', cls: 'workable', src: 'you', refresh: 'never overwritten',
    grain: 'one row per product', key: 'item_code',
    desc: 'Images and descriptions, shown on the floor catalogue.' },
  { sheet: 'Count_Tasks', cls: 'workable', src: 'you + detection',
    refresh: 'appended', grain: 'one row per assigned count', key: 'item_code',
    desc: 'Stock count assignments and their status. Counts are entered in ' +
      'VASY; the nightly job detects the correction and closes the task.' },
  { sheet: 'Customer_Requests', cls: 'workable', src: 'floor app',
    refresh: 'appended', grain: 'one row per capture', key: 'logged_at',
    desc: 'What customers asked for that we could not supply. The only ' +
      'record of demand we failed to serve — it exists nowhere in Vasy.' },
  { sheet: 'Supplier_Leadtime', cls: 'workable', src: 'you', refresh: 'never',
    grain: 'one row per supplier', key: 'supplier_name',
    desc: 'Lead days per supplier, entered by hand until the PO join exists. ' +
      'Feeds safety stock and reorder points.' },

  /* ── COMPUTED: rebuilt on a schedule, safe to delete ── */
  { sheet: 'Sales_Monthly', cls: 'computed', src: 'Sales_Items_*',
    refresh: 'nightly 22:00', grain: 'product x month', key: 'item_code + month',
    desc: 'Demand rollup. What every dashboard reads instead of scanning ' +
      'raw lines. Retains full history even after old raw years are archived.' },
  { sheet: 'Product_Analytics', cls: 'computed',
    src: 'Sales_Monthly + ERP_Snapshot + Pricing + Batch_Cost',
    refresh: 'nightly 22:00', grain: 'one row per product', key: 'item_code',
    desc: 'The spine: ABC, XYZ, movement, cover, turns, GMROI, safety stock, ' +
      'reorder point and a single recommended action per product.' },
  { sheet: 'Customer_Outstanding', cls: 'computed', src: 'Sales_Invoices_*',
    refresh: 'nightly 22:00', grain: 'one row per customer', key: 'contactId',
    desc: 'Invoice-level receivables with 30/60/90 ageing. Understates true ' +
      'exposure while receipts remain unallocated — see the receivables page.' },
  { sheet: 'Batch_Cost', cls: 'computed', src: 'Purchase_Register',
    refresh: 'nightly 03:00', grain: 'one row per canonical product',
    key: 'canonical_code',
    desc: 'Last purchase rate and landing cost per lane, from the register. ' +
      'Reference for verification, not a verified cost itself.' },
  { sheet: 'Dash_Data', cls: 'computed', src: 'Pricing + Products_Core + Media',
    refresh: 'nightly 05:00', grain: 'one row per product', key: 'item_code',
    desc: 'Flattened feed for the pricing dashboard.' },
  { sheet: 'Read_Models', cls: 'computed', src: 'Product_Analytics + Dash_Data',
    refresh: 'nightly 22:00', grain: 'JSON chunks', key: 'model + seq',
    desc: 'Precomputed JSON the dashboards read — about 40 cells instead of ' +
      '330,000. Delete freely; it rebuilds.' },
  { sheet: 'Stock_History', cls: 'computed', src: 'ERP_Snapshot',
    refresh: 'nightly 23:00', grain: 'item x date, changes only',
    key: 'item_code + date',
    desc: 'Stock movement over time. Monthly full anchor plus daily deltas, ' +
      'so any past date is reconstructable. Needed for true turns and ' +
      'stockout days — neither is computable without it.' },
  { sheet: 'Stock_Latest', cls: 'computed', src: 'ERP_Snapshot',
    refresh: 'nightly 23:00', grain: 'one row per SKU', key: 'item_code',
    desc: 'Last known quantity per SKU. The baseline the delta compares against.' },
  { sheet: 'Verify_Log', cls: 'computed', src: 'pricing edits',
    refresh: 'appended', grain: 'one row per field change', key: 'at + item_code',
    desc: 'Every pricing change: old value, new value, who, when, source. ' +
      'Verified_Pricing is the current state; this is why it is what it is.' },
  { sheet: 'Automation_Log', cls: 'computed', src: 'nightly jobs',
    refresh: 'appended', grain: 'one row per job run', key: 'when',
    desc: 'What ran, when, and whether it worked. First place to look when a ' +
      'number looks wrong.' },

  /* ── CONFIG ── */
  { sheet: 'Inventory_Config', cls: 'config', src: 'you', refresh: 'never',
    grain: 'one row per setting', key: 'setting',
    desc: 'Holding cost, service levels by ABC class, dead and slow ' +
      'thresholds, reserve quantity, lead time default. Every inventory ' +
      'calculation reads these rather than hardcoding.' },
  { sheet: 'Category_Rules', cls: 'config', src: 'you', refresh: 'never',
    grain: 'one row per category', key: 'category',
    desc: 'Per-category pricing and margin rules.' },
  { sheet: 'Rate_Card', cls: 'config', src: 'you', refresh: 'never',
    grain: 'one row per customer tier', key: 'tier',
    desc: 'Customer-tier discount structure.' },

  /* ── the parallel pricing model — see the note in buildDataCatalog ── */
  { sheet: 'Pricing', cls: 'legacy', src: 'ERP_Snapshot + Batch_Cost + Cost_Current',
    refresh: 'nightly, formulas frozen to values', grain: 'one row per canonical product',
    key: 'item_code',
    desc: 'THE OLD PRICING MODEL, still driving Dash_Data and the pricing ' +
      'dashboard. Superseded by Verified_Pricing for the eight controllables, ' +
      'but not yet retired — so two models currently disagree about the same ' +
      'numbers. Contains cost_frozen_exGST and cost_source, both of which pick ' +
      'between untrusted values. Resolve before trusting either.' },

  /* ── workable ── */
  { sheet: 'Change_Queue', cls: 'workable', src: 'dashboard edits',
    refresh: 'appended', grain: 'one row per staged change', key: 'batch_id',
    desc: 'Price changes staged for approval: staged, approved, uploaded, ' +
      'applied. Nothing reaches the master without passing through here.' },
  { sheet: 'Vasy_Upload_Queue', cls: 'workable', src: 'approved changes',
    refresh: 'appended', grain: 'one row per change to push', key: 'item_code',
    desc: 'Approved changes waiting to be entered in Vasy, so our numbers and ' +
      'the ERP converge.' },
  { sheet: 'Receipts', cls: 'workable', src: 'manual upload of the Vasy export',
    refresh: 'when you upload', grain: 'one row per receipt', key: 'receipt_no',
    desc: 'Receipts export. Against Bill lines are already tied to invoices; ' +
      'On Account and Advance are not — that untagged money is why invoice ' +
      'ageing overstates what is truly owed.' },
  { sheet: 'Supplier_Cards', cls: 'workable', src: 'you', refresh: 'never',
    grain: 'one row per supplier', key: 'supplier',
    desc: 'Supplier terms and notes.' },
  { sheet: 'Verify_Queue', cls: 'computed', src: 'Purchase_Register + Verified_Pricing',
    refresh: 'on demand', grain: 'one row per bill line needing verification',
    key: 'bill_no + item_code',
    desc: 'What to verify next, grouped by purchase bill and ordered by the ' +
      'revenue riding on those products.' },

  /* ── computed ── */
  { sheet: 'Review_Feed', cls: 'computed', src: 'overnight comparison',
    refresh: 'nightly', grain: 'one row per detected change', key: 'item_code',
    desc: 'What moved overnight and where it came from.' },
  { sheet: 'Lane_Audit', cls: 'computed', src: 'Purchase_Register',
    refresh: 'on demand', grain: 'one row per lane-mixing line', key: 'item_code',
    desc: 'Purchase lines where the W/WO lane looks inconsistent. A data ' +
      'quality report, not a decision input.' },
  { sheet: 'Count_Log', cls: 'computed', src: 'count detection',
    refresh: 'appended', grain: 'one row per detected count', key: 'detected_at',
    desc: 'Every stock correction detected from Vasy, with the expected and ' +
      'actual quantities that revealed it.' },
  { sheet: 'CC_Sweep_Order', cls: 'computed', src: 'Products_Core',
    refresh: 'rebuilt each full sweep', grain: 'one product id per row',
    key: 'productId',
    desc: 'Internal cursor for the resumable cost sweep. Machine bookkeeping ' +
      '— no business meaning. Ignore for RAG.' },
  { sheet: 'Sync_Meta', cls: 'computed', src: 'pull jobs', refresh: 'per run',
    grain: 'one row per sync marker', key: 'key',
    desc: 'Last-sync markers for incremental pulls. Machine bookkeeping.' },

  /* ── config ── */
  { sheet: 'Commodity_Rates', cls: 'config', src: 'you', refresh: 'never',
    grain: 'one row per commodity', key: 'commodity',
    desc: 'Base metal and commodity rates for cost-plus categories.' },
  { sheet: 'Rate_Increments', cls: 'config', src: 'you', refresh: 'never',
    grain: 'one row per rule', key: 'rule',
    desc: 'Standard increments applied when deriving one lane from the other.' },

  /* ── legacy: safe to delete ── */
  { sheet: 'Master_Staging', cls: 'legacy', src: '(none)', refresh: 'never',
    grain: 'empty', key: '-',
    desc: 'Left from the first build. Empty and unused — delete it.' },
];

function catFind_(name) {
  const books = vtBooks();
  const hits = [];
  Object.keys(books).forEach(function (alias) {
    let ss;
    try { ss = SpreadsheetApp.openById(books[alias]); } catch (e) { return; }
    ss.getSheets().forEach(function (sh) {
      const n = sh.getName();
      const pattern = name.replace('_YYYY', '_');
      const match = name.indexOf('_YYYY') > 0 ? (n.indexOf(pattern) === 0) : (n === name);
      if (match) hits.push({ alias: alias, name: n, rows: Math.max(0, sh.getLastRow() - 1) });
    });
  });
  return hits;
}

function buildDataCatalog() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(CAT.SHEET);
  if (!sh) sh = ss.insertSheet(CAT.SHEET);
  sh.clear();
  sh.clearConditionalFormatRules();

  const rows = [];
  CAT_DEFS.forEach(function (d) {
    const hits = catFind_(d.sheet);
    const where = hits.length ? hits.map(function (h) { return h.alias; })
      .filter(function (v, i, a) { return a.indexOf(v) === i; }).join(', ') : '(not present)';
    const rowCount = hits.reduce(function (s, h) { return s + h.rows; }, 0);
    rows.push([
      hits.length > 1 ? d.sheet + '  (' + hits.length + ' tabs)' : d.sheet,
      where, d.cls, d.src, d.refresh, d.grain, d.key,
      hits.length ? rowCount : '',
      d.cls === 'legacy' ? 'RETIRE' :
        (d.cls === 'raw' || d.cls === 'computed' ? 'NO — overwritten' : 'yes'),
      d.desc,
    ]);
  });

  sh.getRange(1, 1, 1, CAT_COLS.length).setValues([CAT_COLS])
    .setFontWeight('bold').setBackground('#CC3018').setFontColor('#FFFFFF');
  sh.setFrozenRows(1);
  sh.getRange(2, 1, rows.length, CAT_COLS.length).setValues(rows);
  sh.setColumnWidth(1, 180);
  sh.setColumnWidth(4, 240);
  sh.setColumnWidth(6, 220);
  sh.setColumnWidth(10, 520);
  sh.getRange(2, 10, rows.length, 1).setWrap(true);

  /* colour by class, so the distinction is visible at a glance */
  const rng = sh.getRange(2, 1, rows.length, CAT_COLS.length);
  const rule = function (cls, bg) {
    return SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=$C2="' + cls + '"').setBackground(bg)
      .setRanges([rng]).build();
  };
  sh.setConditionalFormatRules([
    rule('raw', '#E9F0F9'), rule('workable', '#E9F3ED'),
    rule('computed', '#F7F6F3'), rule('config', '#FDF5E4'),
    rule('legacy', '#FBEEEC'),
  ]);

  const byCls = {};
  CAT_DEFS.forEach(function (d) { byCls[d.cls] = (byCls[d.cls] || 0) + 1; });
  const msg = 'DATA CATALOGUE\n\n' +
    Object.keys(byCls).sort().map(function (k) { return '   ' + k + ': ' + byCls[k]; }).join('\n') +
    '\n\nblue = raw from Vasy, overwritten nightly — never hand-edit\n' +
    'red = LEGACY, superseded — retire it\n' +
    'green = workable, you own it, nothing overwrites it\n' +
    'grey = computed, rebuilt on a schedule, safe to delete\n' +
    'amber = config\n\nRun catalogAudit() to find anything not listed.';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  return rows.length;
}

/** every sheet that exists but is not catalogued, and vice versa */
function catalogAudit() {
  const known = {};
  CAT_DEFS.forEach(function (d) { known[d.sheet] = d.cls; });
  const books = vtBooks();
  const uncatalogued = [], missing = [];
  const seen = {};

  Object.keys(books).forEach(function (alias) {
    let ss;
    try { ss = SpreadsheetApp.openById(books[alias]); } catch (e) { return; }
    ss.getSheets().forEach(function (sh) {
      const n = sh.getName();
      if (n === 'README' || n === CAT.SHEET) return;
      seen[n] = alias;
      if (known[n]) return;
      const base = n.replace(/_\d{4}$/, '_YYYY');
      if (known[base]) return;
      uncatalogued.push('   ' + n + '  (' + alias + ', ' +
        Math.max(0, sh.getLastRow() - 1).toLocaleString() + ' rows)');
    });
  });
  CAT_DEFS.forEach(function (d) {
    if (!catFind_(d.sheet).length) missing.push('   ' + d.sheet + '  (' + d.cls + ')');
  });

  const msg = 'CATALOGUE AUDIT\n\n' +
    (uncatalogued.length ? 'IN THE SHEETS BUT NOT CATALOGUED:\n' + uncatalogued.join('\n') +
      '\n   These are invisible to anything reading the catalogue — including RAG.\n\n'
      : 'Every existing sheet is catalogued.\n\n') +
    (missing.length ? 'CATALOGUED BUT NOT PRESENT:\n' + missing.join('\n') +
      '\n   Either not built yet, or removed.' : 'Every catalogued sheet exists.');
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg.slice(0, 1400)); } catch (e) {}
}

/** machine-readable manifest, for the retrieval layer */
function catalogJson() {
  const out = CAT_DEFS.map(function (d) {
    const hits = catFind_(d.sheet);
    return {
      sheet: d.sheet, class: d.cls, source: d.src, refresh: d.refresh,
      grain: d.grain, key: d.key, description: d.desc,
      editable: d.cls === 'workable' || d.cls === 'config',
      trustworthy_as_fact: d.cls === 'workable',
      present: hits.length > 0,
      locations: hits.map(function (h) { return { book: h.alias, tab: h.name, rows: h.rows }; }),
    };
  });
  const json = JSON.stringify({ generated: new Date().toISOString(), sheets: out }, null, 2);
  Logger.log(json);
  return json;
}

function onOpenCatalog() {
  SpreadsheetApp.getUi()
    .createMenu('📖 Catalogue')
    .addItem('Build Data_Catalog', 'buildDataCatalog')
    .addItem('Audit', 'catalogAudit')
    .addToUi();
}