/**********************************************************************
 * VITHYA TRADERS — SALES LIST BODY FINDER  +  TRANSACTIONS WORKBOOK
 *
 * TWO JOBS
 *
 * 1. POST /api/v1/sales returns a GENERIC 400 (not Vasy's
 *    {"status":false,...} format). A generic 400 means the JSON body did not
 *    deserialize at all — so the field NAMES or TYPES are wrong, not the
 *    business logic. This tries the plausible shapes systematically instead
 *    of one guess per round.
 *
 * 2. Sets up the separate transactions workbook, so the sales pull never
 *    writes into the master sheet. (The earlier puller wrote to the ACTIVE
 *    spreadsheet — that was wrong and is corrected here.)
 *
 * RUN
 *   findSalesListBody()     ~20 quick calls, read only, no rate-limit risk
 *   setupTransactionsBook() creates / links VT_Transactions
 **********************************************************************/

const SLB = {
  BASE: 'VASY_BASE_URL',
  TOKEN: 'VASY_API_TOKEN',
  BRANCH: 'VASY_BRANCH_ID',
  TXN_ID: 'VT_TXN_BOOK_ID',
  GAP: 1500,
};

function slbProp_(k, dflt) {
  const v = PropertiesService.getScriptProperties().getProperty(k);
  if (!v && dflt === undefined) throw new Error('Missing Script Property: ' + k);
  return v ? String(v).trim() : dflt;
}

/* ---------- 2. the separate transactions workbook ---------- */

/**
 * Creates VT_Transactions (or links an existing one) and remembers its id.
 * Every transaction pull writes THERE, never into the master sheet.
 */
function setupTransactionsBook() {
  const props = PropertiesService.getScriptProperties();
  const existing = props.getProperty(SLB.TXN_ID);
  if (existing) {
    try {
      const ss = SpreadsheetApp.openById(existing);
      const msg = 'Already linked:\n\n' + ss.getName() + '\n' + ss.getUrl();
      Logger.log(msg);
      try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
      return existing;
    } catch (e) { /* stale id, fall through and make a new one */ }
  }
  const ss = SpreadsheetApp.create('VT_Transactions');
  const first = ss.getSheets()[0];
  first.setName('README');
  first.getRange(1, 1, 9, 1).setValues([
    ['VT_Transactions'],
    [''],
    ['Holds the high-volume transaction data, kept OUT of the master workbook.'],
    ['The master holds ~1.3M cells; sales alone would be ~10.7M and exceed the'],
    ['10M limit of a single workbook.'],
    [''],
    ['Sales_Invoices    one row per invoice — drives outstanding'],
    ['Sales_Items       line level, current + previous FY only'],
    ['Sales_Monthly     product x month rollup — what the dashboards read'],
  ]);
  first.getRange(1, 1).setFontWeight('bold').setFontSize(13);
  props.setProperty(SLB.TXN_ID, ss.getId());

  const msg = 'Created VT_Transactions\n\n' + ss.getUrl() +
    '\n\nIts id is stored in Script Property ' + SLB.TXN_ID +
    ', so every transaction pull writes there instead of the master sheet.';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  return ss.getId();
}

/** Point at a workbook you already made, instead of creating one. */
function linkTransactionsBook(id) {
  if (!id) throw new Error('Pass the workbook id: linkTransactionsBook("1AbC...")');
  const ss = SpreadsheetApp.openById(String(id).trim());   // throws if wrong
  PropertiesService.getScriptProperties().setProperty(SLB.TXN_ID, ss.getId());
  const msg = 'Linked: ' + ss.getName() + '\n' + ss.getUrl();
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
}

/** Used by the pullers — every transaction write goes through this. */
function txnBook_() {
  const id = PropertiesService.getScriptProperties().getProperty(SLB.TXN_ID);
  if (!id) throw new Error('Run setupTransactionsBook() first.');
  return SpreadsheetApp.openById(id);
}

function txnStatus() {
  const id = PropertiesService.getScriptProperties().getProperty(SLB.TXN_ID);
  if (!id) { 
    try { SpreadsheetApp.getUi().alert('Not set up yet — run setupTransactionsBook().'); } catch (e) {}
    return;
  }
  const ss = SpreadsheetApp.openById(id);
  let cells = 0;
  const lines = ss.getSheets().map(s => {
    const c = s.getLastRow() * s.getLastColumn();
    cells += c;
    return '   ' + s.getName() + ': ' + s.getLastRow() + ' rows, ' + c.toLocaleString() + ' cells';
  });
  const msg = ss.getName() + '\n' + ss.getUrl() + '\n\n' + lines.join('\n') +
    '\n\nTOTAL ' + cells.toLocaleString() + ' cells of 10,000,000';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
}

function onOpenTxn() {
  SpreadsheetApp.getUi()
    .createMenu('🗄️ Transactions')
    .addItem('Set up VT_Transactions', 'setupTransactionsBook')
    .addItem('Transactions status', 'txnStatus')
    .addToUi();
}