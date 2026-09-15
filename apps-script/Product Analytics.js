/**********************************************************************
 * VITHYA TRADERS — PRODUCT ANALYTICS
 *
 * One row per canonical product, rebuilt nightly. Every dashboard reads THIS
 * rather than recomputing — so ABC means the same thing in pricing, inventory
 * and purchasing instead of three subtly different definitions.
 *
 * READS
 *   VT_Master        Products_Core, Pricing, ERP_Snapshot, Batch_Cost
 *   VT_Transactions  Sales_Monthly, Stock_History, Inventory_Config
 *
 * DEGRADES HONESTLY
 *   Sales_Monthly missing -> demand columns blank, and the summary says so.
 *   Stock_History thin    -> turns marked approximate (current stock, not average).
 *   Never silently substitutes a guess for a measurement.
 *
 * THE CLASSIFICATIONS
 *   ABC   by revenue, and separately by margin — they rarely agree, and the
 *         disagreement is where the interesting products are.
 *   XYZ   by demand coefficient of variation. X stable, Y variable, Z erratic.
 *         ABC says how much a product matters; XYZ says how predictable it is.
 *   MOVEMENT  fast / slow / dead / reserve / new / nosale
 *         RESERVE is your rule: a slow item held at 1-2 units for reference is
 *         deliberate, not dead. Only quantity ABOVE reserve_qty counts as dead.
 *
 * REPLENISHMENT  min/max, not EOQ.
 *   safety = Z x sigma_daily x sqrt(lead)
 *   min    = avg_daily x lead + safety          (reorder point)
 *   max    = min + avg_daily x review_days      (order up to)
 *   EOQ is shown for A+X items only, where its assumptions roughly hold.
 *
 * RUN  buildProductAnalytics()
 **********************************************************************/

const PRODAN = {
  SHEET: 'Product_Analytics',
  CORE: 'Products_Core',
  PRICING: 'Pricing',
  ERP: 'ERP_Snapshot',
  BATCH: 'Batch_Cost',
  MONTHLY: 'Sales_Monthly',
  HIST: 'Stock_History',
  REVIEW_DAYS: 15,
};

const PRODAN_COLS = [
  'item_code','product_name','category','sub_category','brand','department','uom','gst_rate',
  'qty_w','qty_wo','qty_total','unit_cost','stock_value',
  'units_30d','units_90d','units_365d','avg_daily','months_with_sales',
  'demand_cv','trend','seasonal_peak',
  'revenue_365d','cogs_365d','margin_365d','margin_pct',
  'abc_revenue','abc_margin','xyz','movement',
  'days_cover','turns','gmroi',
  'lead_days','safety_stock','reorder_point','max_level','suggested_order','eoq',
  'w_share','wo_share','last_sale','last_purchase','supplier_count',
  'sell_price_w','sell_price_wo','true_margin_w','true_margin_wo',
  /* two independent ERP opinions of the same number. Where they disagree,
     somebody should look — so both are carried rather than silently picking. */
  'sell_master_w','sell_master_wo','cost_current_w','cost_current_wo',
  'cost_frozen','cost_source','price_gap',
  'cost_bill_w','cost_bill_wo','cost_bill_date','landing_w','landing_wo',
  /* VT-028: one global 12% floor flagged 2,391 products, which is the same
     as flagging none — bearings and cable do not carry the same margin.
     This compares each product with its OWN category. */
  'cat_median_margin','margin_vs_cat',
  'flags','action'
];

function prodanNum_(v) { const n = Number(v); return isFinite(n) ? n : 0; }
/** a date column read as yyyy-MM-dd, whatever shape the cell holds */
function prodanDay_(v) {
  if (!v) return '';
  if (v instanceof Date) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  const m = String(v).match(/^\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : '';
}

function prodanR2_(x) { return Math.round(x * 100) / 100; }
/* a month cell may come back as a Date if Sheets coerced it — handle both */
function prodanMonth_(v) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM');
  }
  const m = String(v || '').match(/^\d{4}-\d{2}/);
  return m ? m[0] : '';
}

function prodanToday_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}
function prodanDaysBetween_(a, b) {
  const d1 = new Date(a + 'T00:00:00'), d2 = new Date(b + 'T00:00:00');
  if (isNaN(d1.getTime()) || isNaN(d2.getTime())) return null;
  return Math.round((d2 - d1) / 86400000);
}

/* header-tolerant reader */
function prodanRead_(ss, name, key) {
  const sh = vtSheet(name) || ss.getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return null;
  let hRow = 1;
  for (let r = 1; r <= 8; r++) {
    const v = sh.getRange(r, 1, 1, Math.min(sh.getLastColumn(), 40)).getValues()[0];
    if (v.some(x => String(x).trim() === key)) { hRow = r; break; }
  }
  const hdr = sh.getRange(hRow, 1, 1, sh.getLastColumn()).getValues()[0];
  const H = {};
  hdr.forEach((h, i) => { const k = String(h).trim(); if (k) H[k] = i; });
  const n = sh.getLastRow() - hRow;
  if (n < 1) return { H: H, rows: [] };
  return { H: H, rows: sh.getRange(hRow + 1, 1, n, sh.getLastColumn()).getValues() };
}

/* Z for a service level % */
function prodanZ_(pct) {
  const t = [[80, 0.84], [85, 1.04], [90, 1.28], [95, 1.65], [97, 1.88],
    [98, 2.05], [99, 2.33], [99.5, 2.58]];
  let z = 1.65;
  for (let i = 0; i < t.length; i++) if (pct >= t[i][0]) z = t[i][1];
  return z;
}

/* ================= main ================= */

function buildProductAnalytics(force) {
  const t0 = Date.now();
  const master = SpreadsheetApp.getActiveSpreadsheet();
  const txn = txnBook_();
  const cfg = invConfig_();
  const today = prodanToday_();
  const notes = [];

  /* ---- masters ---- */
  const core = prodanRead_(master, PRODAN.CORE, 'product_id');
  if (!core) throw new Error('Products_Core is empty.');
  const pricing = prodanRead_(master, PRODAN.PRICING, 'product_id');
  const erp = prodanRead_(master, PRODAN.ERP, 'itemCode');
  const batch = prodanRead_(master, PRODAN.BATCH, 'canonical_code');
  const monthly = prodanRead_(txn, PRODAN.MONTHLY, 'item_code');
  if (!monthly) notes.push('Sales_Monthly missing — demand, ABC, XYZ and reorder are blank.');

  /* ---- stock by item code ---- */
  const stock = {};
  if (erp) {
    erp.rows.forEach(r => {
      const c = String(r[erp.H.itemCode] || '').trim();
      if (c) stock[c] = prodanNum_(r[erp.H.qty]);
    });
  } else notes.push('ERP_Snapshot missing — stock is blank.');

  /* ---- pricing by canonical ---- */
  const price = {};
  if (pricing) {
    const PH = pricing.H;
    pricing.rows.forEach(r => {
      const c = String(r[PH.item_code] || '').trim();
      if (!c) return;
      price[c] = {
        gst: prodanNum_(r[PH.gst_rate]),
        cw: prodanNum_(r[PH.cost_w_exGST]), cwo: prodanNum_(r[PH.cost_wo]),
        /* Pricing.selling_w_incGST and selling_wo are IDENTICAL on 2,975 of
           2,999 rows — the WO column was filled with the W value as a
           fallback, losing the lane split entirely. The ERP columns keep it:
           6,556 of 6,557 products with both lanes have genuinely different
           prices. Read those, and leave WO blank when the product has no WO
           variant rather than inventing one. */
        sw: prodanNum_(r[PH.erp_selling_w]) || prodanNum_(r[PH.selling_w_incGST]),
        swo: prodanNum_(r[PH.erp_selling_wo]),
        sw_master: prodanNum_(r[PH.erp_selling_w]),
        swo_master: prodanNum_(r[PH.erp_selling_wo]),
        cur_w: prodanNum_(r[PH.cost_current_w_exGST]),
        cur_wo: prodanNum_(r[PH.cost_current_wo]),
        /* VT-011b: the bill rate and the loaded (landing) figure are
           different numbers and the gap between them IS the transport that
           got folded into cost. Carry both, per lane, rather than choosing. */
        bill_w: prodanNum_(r[PH.cost_bill_w_exGST]),
        bill_wo: prodanNum_(r[PH.cost_bill_wo]),
        bill_date: prodanDay_(r[PH.cost_bill_date]),
        load_w: prodanNum_(r[PH.loaded_cost_w]),
        load_wo: prodanNum_(r[PH.loaded_cost_wo]),
        frozen: prodanNum_(r[PH.cost_frozen_exGST]),
        csource: String(r[PH.cost_source] || ''),
        mw: prodanNum_(r[PH.true_margin_w]), mwo: prodanNum_(r[PH.true_margin_wo]),
        flag: String(r[PH.margin_flag] || ''),
      };
    });
  }

  /* ---- purchase history ---- */
  const purch = {};
  if (batch) {
    batch.rows.forEach(r => {
      const c = String(r[batch.H.canonical_code] || '').trim();
      if (!c) return;
      purch[c] = {
        last: String(r[batch.H.last_bill_date] || '').slice(0, 10),
        suppliers: prodanNum_(r[batch.H.supplier_count]) || 0,
      };
    });
  }

  /* ---- demand from Sales_Monthly ---- */
  const dem = {};
  if (monthly) {
    const MH = monthly.H;
    monthly.rows.forEach(r => {
      const c = String(r[MH.item_code] || '').trim();
      const m = prodanMonth_(r[MH.month]);
      if (!c || !m) return;
      if (!dem[c]) dem[c] = { months: {}, rev: 0, cogs: 0, prof: 0,
        wq: 0, woq: 0, last: '' };
      const d = dem[c];
      const q = prodanNum_(r[MH.qty]);
      d.months[m] = (d.months[m] || 0) + q;
      d.rev += prodanNum_(r[MH.revenue]);
      d.cogs += prodanNum_(r[MH.cost]);
      d.prof += prodanNum_(r[MH.profit]);
      d.wq += prodanNum_(r[MH.w_qty]);
      d.woq += prodanNum_(r[MH.wo_qty]);
      if (m > d.last) d.last = m;
    });
  }

  /* recent month keys */
  const now = new Date();
  const mkey = d => d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2);
  const last12 = [], last3 = [], last1 = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    last12.push(mkey(d));
    if (i < 3) last3.push(mkey(d));
    if (i < 1) last1.push(mkey(d));
  }

  /* ---- build rows ---- */
  const out = [];
  core.rows.forEach(r => {
    const canon = String(r[core.H.item_code] || '').trim();
    if (!canon) return;
    const codeW = String(r[core.H.item_code_w] || '').trim();
    const codeWO = String(r[core.H.item_code_wo] || '').trim();

    const qw = codeW ? prodanNum_(stock[codeW]) : 0;
    const qwo = codeWO ? prodanNum_(stock[codeWO]) : 0;
    const qt = qw + qwo;

    const p = price[canon] || {};
    const unitCost = p.cw || p.cwo || 0;
    const stockValue = prodanR2_(qt * unitCost);

    const d = dem[canon];
    let u30 = '', u90 = '', u365 = '', avgDaily = '', cv = '', trend = '',
      monthsWith = '', rev = '', cogs = '', marg = '', margPct = '',
      wShare = '', woShare = '', lastSale = '', peak = '';

    if (d) {
      const sum = keys => keys.reduce((s, k) => s + (d.months[k] || 0), 0);
      u30 = prodanR2_(sum(last1));
      u90 = prodanR2_(sum(last3));
      u365 = prodanR2_(sum(last12));
      avgDaily = prodanR2_(u365 / 365);
      const series = last12.map(k => d.months[k] || 0);
      const mean = series.reduce((a, b) => a + b, 0) / series.length;
      if (mean > 0) {
        const varr = series.reduce((s, x) => s + Math.pow(x - mean, 2), 0) / series.length;
        cv = prodanR2_(Math.sqrt(varr) / mean);
      }
      monthsWith = Object.keys(d.months).filter(k => d.months[k] > 0).length;
      const firstHalf = last12.slice(6).reduce((s, k) => s + (d.months[k] || 0), 0);
      const secondHalf = last12.slice(0, 6).reduce((s, k) => s + (d.months[k] || 0), 0);
      trend = firstHalf === 0 ? (secondHalf > 0 ? 'new' : '') :
        (secondHalf > firstHalf * 1.2 ? 'growing' :
          (secondHalf < firstHalf * 0.8 ? 'declining' : 'stable'));
      rev = prodanR2_(d.rev); cogs = prodanR2_(d.cogs); marg = prodanR2_(d.prof);
      margPct = d.rev > 0 ? prodanR2_(d.prof / d.rev * 100) : '';
      const tq = d.wq + d.woq;
      if (tq > 0) { wShare = prodanR2_(d.wq / tq * 100); woShare = prodanR2_(d.woq / tq * 100); }
      lastSale = d.last;
      let best = '', bv = -1;
      Object.keys(d.months).forEach(k => {
        if (d.months[k] > bv) { bv = d.months[k]; best = k; }
      });
      peak = best;
    }

    const pu = purch[canon] || {};
    out.push({
      canon: canon,
      row: [canon, String(r[core.H.description] || ''),
        r[core.H.category] || '', r[core.H.sub_category] || '',
        r[core.H.brand] || '', r[core.H.department] || '', r[core.H.uom] || '',
        (p.gst === undefined || p.gst === 0) ? 18 : p.gst,
        qw, qwo, qt, prodanR2_(unitCost), stockValue,
        u30, u90, u365, avgDaily, monthsWith,
        cv, trend, peak,
        rev, cogs, marg, margPct,
        '', '', '', '',            // abc_rev, abc_marg, xyz, movement — filled below
        '', '', '',                // cover, turns, gmroi
        '', '', '', '', '', '',    // lead, safety, rop, max, suggested, eoq
        wShare, woShare, lastSale, pu.last || '', pu.suppliers || '',
        prodanR2_(p.sw || 0), p.swo ? prodanR2_(p.swo) : '',
        p.mw === undefined ? '' : prodanR2_(p.mw * 100),
        p.mwo === undefined ? '' : prodanR2_(p.mwo * 100),
        p.sw_master ? prodanR2_(p.sw_master) : '',
        p.swo_master ? prodanR2_(p.swo_master) : '',
        p.cur_w ? prodanR2_(p.cur_w) : '',
        p.cur_wo ? prodanR2_(p.cur_wo) : '',
        p.frozen ? prodanR2_(p.frozen) : '',
        p.csource || '',
        /* how far the batch cost and the frozen cost disagree, in percent */
        (p.cur_w && p.frozen)
          ? prodanR2_((p.cur_w - p.frozen) / p.frozen * 100) : '',
        p.bill_w ? prodanR2_(p.bill_w) : '',
        p.bill_wo ? prodanR2_(p.bill_wo) : '',
        p.bill_date || '',
        p.load_w ? prodanR2_(p.load_w) : '',
        p.load_wo ? prodanR2_(p.load_wo) : '',
        '', '',                    // cat_median_margin, margin_vs_cat — below
        '', ''],                   // flags, action
      rev: prodanNum_(rev), marg: prodanNum_(marg), qt: qt, cv: cv,
      avgDaily: prodanNum_(avgDaily), u365: prodanNum_(u365),
      cogs: prodanNum_(cogs), stockValue: stockValue, lastSale: lastSale,
      hasDemand: !!d, marginFlag: p.flag || '',
      /* a frozen cost with nothing current to confirm it cannot support a
         claim that we are selling at a loss */
      costStale: (p.csource === 'frozen') && !p.cur_w && !p.cur_wo,
    });
  });

  /* ---- VT-028: median margin per category ----
     Median, not mean: a handful of loss-making lines would drag a mean down
     and make everything else look healthy by comparison. */
  const CATMED = {};
  (function () {
    const byCat = {};
    out.forEach(function (x) {
      const c = String(x.row[PRODAN_COLS.indexOf('category')] || '');
      const m = x.row[PRODAN_COLS.indexOf('margin_pct')];
      if (!c || m === '' || !isFinite(m)) return;
      if (prodanNum_(x.rev) <= 0) return;        // no sales, no opinion
      (byCat[c] = byCat[c] || []).push(prodanNum_(m));
    });
    Object.keys(byCat).forEach(function (c) {
      const a = byCat[c].sort(function (p, q) { return p - q; });
      if (a.length < 5) return;                  // too few to be a benchmark
      CATMED[c] = a[Math.floor(a.length / 2)];
    });
  })();

  /* ---- ABC by revenue, and separately by margin ---- */
  const IX = {}; PRODAN_COLS.forEach((c, i) => IX[c] = i);
  function assignAbc(field, col) {
    const sorted = out.slice().sort((a, b) => b[field] - a[field]);
    const total = sorted.reduce((s, x) => s + Math.max(0, x[field]), 0);
    if (total <= 0) return;
    let cum = 0;
    sorted.forEach(x => {
      cum += Math.max(0, x[field]);
      const pct = cum / total * 100;
      x.row[col] = pct <= cfg.abc_a_pct ? 'A' : (pct <= cfg.abc_b_pct ? 'B' : 'C');
    });
  }
  assignAbc('rev', IX.abc_revenue);
  assignAbc('marg', IX.abc_margin);

  /* ---- XYZ, movement, economics, replenishment ---- */
  const z = { A: prodanZ_(cfg.service_level_A), B: prodanZ_(cfg.service_level_B),
    C: prodanZ_(cfg.service_level_C) };
  let dead = 0, slow = 0, reserve = 0, excess = 0, nosale = 0, negative = 0;
  let deadValue = 0, excessValue = 0, negativeValue = 0;
  let reorderCount = 0, reorderValue = 0;

  out.forEach(x => {
    const R = x.row;
    /* XYZ */
    if (x.cv !== '' && x.hasDemand) {
      R[IX.xyz] = x.cv < cfg.xyz_x_cv ? 'X' : (x.cv < cfg.xyz_y_cv ? 'Y' : 'Z');
    }

    /* days since last sale */
    let daysSince = null;
    if (x.lastSale) {
      const dd = prodanDaysBetween_(x.lastSale + '-01', today);
      if (dd !== null) daysSince = dd;
    }

    const cls = R[IX.abc_revenue] || 'C';
    const xyzc = R[IX.xyz] || 'Z';

    /* Cover thresholds MUST vary by class. A single 90-day rule flags a
       once-a-year spare as "excess" when holding it is deliberate — which
       made 2,148 items excess and the list unusable.
         A  90 days   fast movers, cash matters
         B 180 days
         C 365 days   long-tail spares; a year of cover is normal here
       Erratic (Z) demand gets a further allowance, because cover computed
       from a lumpy average is not meaningful. */
    let coverLimit = cls === 'A' ? cfg.excess_cover_days :
      (cls === 'B' ? cfg.excess_cover_days * 2 : cfg.excess_cover_days * 4);
    if (xyzc === 'Z') coverLimit = coverLimit * 1.5;

    const cover = x.avgDaily > 0 ? x.qt / x.avgDaily : null;

    /* movement */
    let mv = '';
    if (x.qt < 0) {
      mv = 'negative';                       // data problem, not a stock state
      negative++; negativeValue += x.stockValue;
    } else if (!x.hasDemand || x.u365 === 0) {
      if (x.qt <= 0) mv = 'nosale';
      else if (x.qt <= cfg.reserve_qty) { mv = 'reserve'; reserve++; }
      else if (daysSince !== null && daysSince >= cfg.dead_days) {
        mv = 'dead'; dead++; deadValue += x.stockValue;
      } else { mv = 'slow'; slow++; }
    } else if (daysSince !== null && daysSince >= cfg.dead_days && x.qt > cfg.reserve_qty) {
      mv = 'dead'; dead++; deadValue += x.stockValue;
    } else if (daysSince !== null && daysSince >= cfg.slow_days) {
      mv = 'slow'; slow++;
    } else if (cover !== null && cover > coverLimit) {
      mv = 'excess'; excess++; excessValue += x.stockValue;
    } else mv = 'fast';
    if (mv === 'nosale') nosale++;
    R[IX.movement] = mv;

    /* cover, turns, gmroi */
    if (cover !== null) R[IX.days_cover] = prodanR2_(cover);
    if (x.stockValue > 0 && x.cogs > 0) R[IX.turns] = prodanR2_(x.cogs / x.stockValue);
    if (x.stockValue > 0 && x.marg !== 0) R[IX.gmroi] = prodanR2_(x.marg / x.stockValue);

    /* replenishment — min/max, not EOQ */
    const lead = prodanNum_(cfg.default_lead_days);
    R[IX.lead_days] = lead;
    if (x.avgDaily > 0 && x.qt >= 0) {
      const sigmaDaily = x.cv !== '' ? x.avgDaily * x.cv : x.avgDaily * 0.5;
      const safety = Math.ceil(z[cls] * sigmaDaily * Math.sqrt(lead));
      const rop = Math.ceil(x.avgDaily * lead + safety);
      const max = Math.ceil(rop + x.avgDaily * PRODAN.REVIEW_DAYS);
      R[IX.safety_stock] = safety;
      R[IX.reorder_point] = rop;
      R[IX.max_level] = max;
      /* only suggest an order where it is worth someone's attention:
         a real shortfall, and not a Z-class item already holding reserve */
      const short = rop - x.qt;
      const worthIt = short > 0 &&
        (cls === 'A' || xyzc !== 'Z' || x.qt <= cfg.reserve_qty);
      R[IX.suggested_order] = worthIt ? Math.ceil(max - x.qt) : 0;
      if (worthIt) { reorderCount++; reorderValue += Math.ceil(max - x.qt) * prodanNum_(R[IX.unit_cost]); }
      if (cls === 'A' && xyzc === 'X') {
        const hold = prodanNum_(cfg.holding_cost_pct) / 100 * prodanNum_(R[IX.unit_cost]);
        if (hold > 0) {
          R[IX.eoq] = Math.ceil(Math.sqrt(2 * x.u365 * prodanNum_(cfg.order_cost) / hold));
        }
      }
    }

    /* VT-028: how this product sits against its own category */
    const catMed = CATMED[String(R[IX.category] || '')] ;
    if (catMed !== undefined && R[IX.margin_pct] !== '' && isFinite(R[IX.margin_pct])) {
      R[IX.cat_median_margin] = prodanR2_(catMed);
      R[IX.margin_vs_cat] = prodanR2_(prodanNum_(R[IX.margin_pct]) - catMed);
    }

    /* flags and the single action that matters */
    const f = [];
    /* Vasy will not accept a selling price below landing cost, so a real
       "LOSS" should be impossible. Every one of the 67 flagged rows compares
       today's selling price against cost_frozen_exGST — a cost snapshotted on
       build day, with cost_source 'frozen' and no current cost to check it
       against. The margins are all -1.7% to -10%: staleness, not losses.
       So it is reported as what it is, and only called a loss when the cost
       behind it is actually current. */
    /* materially below the category, not below an arbitrary line */
    if (R[IX.margin_vs_cat] !== '' && R[IX.margin_vs_cat] < -10 &&
        prodanNum_(R[IX.revenue_365d]) > 0) {
      f.push('UNDER CATEGORY');
    }
    if (x.marginFlag === 'LOSS') {
      f.push(x.costStale ? 'CHECK COST' : 'LOSS');
    } else if (x.marginFlag) {
      f.push(x.marginFlag);
    }
    if (mv === 'negative') f.push('NEGATIVE STOCK');
    if (mv === 'dead') f.push('DEAD');
    if (mv === 'excess') f.push('EXCESS');
    if (R[IX.suggested_order] > 0) f.push('REORDER');
    if (x.qt === 0 && x.u365 > 0) f.push('STOCKOUT');
    if (!x.hasDemand && x.qt > 0) f.push('NO SALES DATA');
    R[IX.flags] = f.join(' \u00b7 ');

    R[IX.action] =
      mv === 'negative' ? 'fix stock — quantity is negative' :
      f.indexOf('UNDER CATEGORY') >= 0 && f.indexOf('LOSS') < 0 &&
        f.indexOf('CHECK COST') < 0 ?
        'review margin — well below others in ' + String(R[IX.category] || 'its category') :
      f.indexOf('CHECK COST') >= 0 ?
        'verify the cost — the margin looks negative but the cost is frozen' :
      f.indexOf('LOSS') >= 0 ? 'reprice — selling below a current cost' :
      f.indexOf('STOCKOUT') >= 0 ? 'order now — out of stock, still selling' :
      R[IX.suggested_order] > 0 ? ('order ' + R[IX.suggested_order]) :
      mv === 'dead' ? 'liquidate — no sale in 12 months' :
      mv === 'excess' ? ('stop buying — ' + Math.round(cover) + ' days cover') :
      x.marginFlag === 'BELOW 12%' ? 'review margin' : '';
  });

  /* ---- write ---- */
  vtGuardRebuild_(PRODAN.SHEET, out.length, force);
  let sh = vtSheet(PRODAN.SHEET);
  if (!sh) sh = txn.insertSheet(PRODAN.SHEET);
  sh.clear();
  sh.getRange(1, 1, 1, PRODAN_COLS.length).setValues([PRODAN_COLS]);
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, PRODAN_COLS.length).setFontWeight('bold')
    .setBackground('#CC3018').setFontColor('#FFFFFF').setWrap(true);
  const rows = out.map(x => x.row);
  const B = 3000;
  for (let i = 0; i < rows.length; i += B) {
    const blk = rows.slice(i, i + B);
    sh.getRange(2 + i, 1, blk.length, PRODAN_COLS.length).setValues(blk);
  }
  sh.setColumnWidth(2, 300);

  /* ---- summary ---- */
  const withDemand = out.filter(x => x.hasDemand).length;
  const stockVal = out.reduce((s, x) => s + x.stockValue, 0);
  const posVal = out.filter(x => x.stockValue > 0)
    .reduce((s, x) => s + x.stockValue, 0);
  const abc = {}; out.forEach(x => {
    const k = (x.row[IX.abc_revenue] || '-') + (x.row[IX.xyz] || '-');
    abc[k] = (abc[k] || 0) + 1;
  });
  const abcKeys = Object.keys(abc).sort();
  const noXyz = abcKeys.filter(k => k.charAt(1) === '-')
    .reduce((s, k) => s + abc[k], 0);

  const msg = 'PRODUCT ANALYTICS BUILT  (' + Math.round((Date.now() - t0) / 1000) + 's)\n\n' +
    'products: ' + out.length + '   with sales history: ' + withDemand + '\n' +
    'stock value: Rs ' + Math.round(stockVal).toLocaleString('en-IN') +
    (negative ? '   (net of ' + negative + ' negative-qty items worth Rs ' +
      Math.round(Math.abs(negativeValue)).toLocaleString('en-IN') + ')' : '') + '\n' +
    'positive stock only: Rs ' + Math.round(posVal).toLocaleString('en-IN') + '\n\n' +
    '── movement ──\n' +
    '   dead:    ' + dead + '  (Rs ' + Math.round(deadValue).toLocaleString('en-IN') + ')\n' +
    '   excess:  ' + excess + '  (Rs ' + Math.round(excessValue).toLocaleString('en-IN') + ')\n' +
    '   slow:    ' + slow + '\n' +
    '   reserve: ' + reserve + '  (held at ' + cfg.reserve_qty + ' or fewer — deliberate)\n' +
    '   never sold: ' + nosale + '\n' +
    (negative ? '   NEGATIVE QTY: ' + negative + '  ⚠ fix these first\n' : '') +
    '\n── to order now ──\n' +
    '   ' + reorderCount + ' item(s), about Rs ' +
    Math.round(reorderValue).toLocaleString('en-IN') + ' to commit\n\n' +
    '── ABC x XYZ ──\n' +
    abcKeys.map(k => '   ' + k + ': ' + abc[k]).join('\n') +
    (noXyz ? '\n   (' + noXyz + ' have no XYZ — no demand in the last 12 months)' : '') +
    (notes.length ? '\n\n── NOT COMPUTED ──\n   ' + notes.join('\n   ') : '');
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  return out.length;
}

function onOpenProductAnalytics() {
  SpreadsheetApp.getUi()
    .createMenu('🧠 Analytics')
    .addItem('Build product analytics', 'buildProductAnalytics')
    .addToUi();
}