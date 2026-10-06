/**
 * VITHYA TRADERS — PO REQUEST · LIVE API v2  (pairs with VT-PO v6 "Ganga")
 * Adds read + writeback + receive endpoints for the private Purchase Intelligence dashboard.
 *
 * WHAT'S NEW IN v2 (over the first LiveApi.gs)
 *  - PO Tracking is now UPSERTED by a single stable key (PO Line Key) so re-recording a PO,
 *    editing it, or SPLITTING it no longer creates duplicate rows.
 *  - record now accepts removePoNumbers:[...] — used by the split to delete the parent PO's rows
 *    and replace them with the two child rows (…w / …wo). No leftover parent row.
 *  - PO Tracking carries Real PO No, Parent PO, Sent At, Expected Date, Status (so "mark sent",
 *    the software number, and the split structure all persist to the sheet).
 *  - New Receipts tab + receive endpoint records material inward (partial deliveries supported).
 *  - data now also returns receipts.
 *
 * INSTALL (one redeploy covers phases 2–3)
 *  1. Open the SAME Apps Script project as your existing LiveApi.gs.
 *  2. REPLACE the entire contents of LiveApi.gs with this file. (Keep your main "Ganga" file as-is.)
 *  3. The token now lives in Script Properties (VT_API_TOKEN) — replacing this file no longer wipes it.
 *  4. In your Google Sheet, CLEAR the old test rows in the "PO Tracking" tab
 *     (select the data rows under the header and delete them) — the columns changed in v2.
 *  5. Run setupLiveApi() once (authorise if asked) — it rewrites the PO Tracking header row
 *     to the new columns and creates the Receipts tab.
 *  6. Deploy > Manage deployments > (your web app) > Edit > Version: New version > Deploy.
 *     The /exec URL stays the same.
 *  7. Test:  …/exec?api=ping&token=YOUR_TOKEN   then   …/exec?api=data&token=YOUR_TOKEN
 *
 * [V1.1-01 "Vaigai"] (2026-10) — additive only, nothing removed:
 *  - handleApi_: new routes api=shipment and api=shipmentDelete (code lives in ShipmentApi.gs)
 *  - ping: also returns v11 (the V1.1 server label)
 *  - apiData_: also returns shipments[] and shipAllocs[] (older dashboards ignore them)
 * [V1.1 server 2.1] (2026-10) — additive only:
 *  - routes: shipmentArrive, bill, billStage, billUnassign, billDelete (BillApi.gs / ShipmentApi.gs)
 *  - apiData_: also returns bills[] and billLines[]
 *  - apiLot_: when Script Property V11_LOT_LOCK = on, NEW V1 lots are refused (edits to existing
 *    lots still work) — protects against old dashboard files after the V1.1 go-live
 * [V1.1 server 2.2] (2026-10):
 *  - route poDelete → apiPoDelete_ (ShipmentApi.gs): deleting a PO now removes its PO Tracking rows too
 *  - apiRecord_: removePoNumbers is refused for a PO carried by a V1.1 shipment
 * [V1.1 server 2.3] route v11data → only the V1.1 data, for a fast refresh after a save
 * [V1.1 server 2.5] (2026-10)
 *  - FIX (old V1 bug): two functions were both named apiRegister_ (Supabase here, Sheet in RegisterApi.gs);
 *    whichever file loaded last won, so the register pull broke depending on file order. The Supabase one
 *    is now apiRegisterSb_ and api=register routes by its parameters (offset → Supabase; meta/from/sinceId → Sheet).
 *  - every V1.1 write route returns the fresh V1.1 data (v11) in the same reply — one round trip per save.
 */

/* ── SECRET TOKEN ──────────────────────────────────────────────────────────────
   Stored in Script Properties so REPLACING THIS FILE CAN NEVER WIPE IT AGAIN.
   First run of setupLiveApi() seeds it from DEFAULT_TOKEN below if nothing is set.
   To change it later: Project Settings ▸ Script properties ▸ VT_API_TOKEN.        */
var DEFAULT_TOKEN = '<REDACTED_V1_FALLBACK_TOKEN>';
function apiToken_(){
  try{
    var p = PropertiesService.getScriptProperties();
    var t = p.getProperty('VT_API_TOKEN');
    if (!t){ t = DEFAULT_TOKEN; p.setProperty('VT_API_TOKEN', t); }
    return t;
  }catch(e){ return DEFAULT_TOKEN; }
}
var TRACK_TAB  = 'PO Tracking';
var RECV_TAB   = 'Receipts';
var CLOSED_TAB = 'Closed';                       // optional; read if present
var META_TAB   = 'PO Meta';
var LOTS_TAB   = 'Lots';        // [v4] one row per lot (a real shipment)
var LOTL_TAB   = 'Lot Lines';   // [v4] one row per product per lot — the split-bill register
var AUDIT_TAB  = 'Audit Log';   // [v4] append-only record of everything
var ARCH_TAB   = 'Archive';     // [v4] closed POs + lots moved here                      // [v3] PO-level follow-up state (supplier already per-row too)
var SUP_TAB    = 'Suppliers';                     // [v3] optional supplier contacts (Management-only in dashboard)

// [v3] PO Tracking gains Supplier, Ship Qty, Line Note (per row)
var TRACK_HEADERS = ['Logged At','PO Line Key','Line ID','PO Request No','Product Code','Product Name',
                     'Lane','PO Number','Real PO No','PO Qty','PO Status','Parent PO','Sent At','Expected Date','By',
                     'Supplier','Ship Qty','Line Note'];
var RECV_HEADERS  = ['Logged At','Receipt ID','PO Number','Real PO No','Line ID','Product Code','Product Name',
                     'Lane','Received Qty','Price','Bill/MI No','Received Date','By'];
var META_HEADERS  = ['PO Number','Supplier','Approved At','Bill At','Promised','Snooze Until','Notes JSON','Updated At','By','Closed At','Closed By','Cancel Reason','Cancelled At','Real No'];
var SUP_HEADERS   = ['Name','Lane','Phone','WhatsApp','GSTIN','Lead Days','Notes'];
var LOTS_HEADERS  = ['Lot ID','PO No','Lot #','Date','Transport','LR No','Bill GST','Bill NonGST','MI Ready At','Received At','Uploaded At','Lot Note','Updated At','By','Expected Delivery','Vasy Bill No','Round Off GST','Round Off NonGST','Charges JSON','Totals JSON'];
var LOTL_HEADERS  = ['Lot ID','PO No','Line Idx','Item Code','Item Name','Qty Shipped','GST Qty','NonGST Qty','Bill Rate','Tax %','Upload /','MRP','Selling','Return Qty','Flags','Updated At','By'];
var AUDIT_HEADERS = ['Timestamp','User','Action','Entity','Entity ID','Field','Old','New','Note'];

function setupLiveApi(){
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var t = ss.getSheetByName(TRACK_TAB) || ss.insertSheet(TRACK_TAB);
  t.getRange(1,1,1,TRACK_HEADERS.length).setValues([TRACK_HEADERS])
    .setFontWeight('bold').setBackground('#B8893A').setFontColor('#FFFFFF');
  t.setFrozenRows(1);
  var r = ss.getSheetByName(RECV_TAB) || ss.insertSheet(RECV_TAB);
  r.getRange(1,1,1,RECV_HEADERS.length).setValues([RECV_HEADERS])
    .setFontWeight('bold').setBackground('#1F6B7A').setFontColor('#FFFFFF');
  r.setFrozenRows(1);
  var m = ss.getSheetByName(META_TAB) || ss.insertSheet(META_TAB);
  m.getRange(1,1,1,META_HEADERS.length).setValues([META_HEADERS])
    .setFontWeight('bold').setBackground('#5B4B8A').setFontColor('#FFFFFF');
  m.setFrozenRows(1);
  var sup = ss.getSheetByName(SUP_TAB) || ss.insertSheet(SUP_TAB);
  if (sup.getLastRow() === 0){
    sup.getRange(1,1,1,SUP_HEADERS.length).setValues([SUP_HEADERS])
      .setFontWeight('bold').setBackground('#B8893A').setFontColor('#FFFFFF');
    sup.setFrozenRows(1);
  }
  lotsSheet_(); lotlSheet_(); auditSheet_();
  var tok = apiToken_();   // seeds VT_API_TOKEN on first run and keeps it thereafter
  return 'Live API v7.2 ready — token "'+tok+'" is stored in Script Properties (safe from file replacement) — Lots + Lot Lines + Audit Log tabs created (PO Tracking / PO Meta / Suppliers unchanged).';
}

function doGet(e){
  var p = (e && e.parameter) || {};
  if (p.api) return handleApi_(p.api, p, null);
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Vithya Traders — PO Request')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}
/* [v7.0] write an analytics/fund table to a named tab so the inventory dashboard can fetch it.
   body = { sheet:'SKU Summary', rows:[[...],[...]] }  — the whole tab is replaced. */
function apiWriteSheet_(body){
  var name=String((body&&body.sheet)||'').trim(); if(!name) return {ok:false,error:'no sheet name'};
  var rows=(body&&body.rows)||[]; if(!rows.length) rows=[['(empty)']];
  var lock=LockService.getScriptLock(); lock.waitLock(20000);
  try{
    var ss=SpreadsheetApp.getActiveSpreadsheet();
    var sh=ss.getSheetByName(name)||ss.insertSheet(name);
    sh.clearContents();
    var w=0; for(var i=0;i<rows.length;i++){ if(rows[i].length>w) w=rows[i].length; }
    for(var j=0;j<rows.length;j++){ while(rows[j].length<w) rows[j].push(''); }
    if(rows.length&&w) sh.getRange(1,1,rows.length,w).setValues(rows);
    sh.getRange(1,1,1,w).setFontWeight('bold');
    return {ok:true, sheet:name, rows:rows.length, cols:w, at:new Date().toISOString() };
  } finally { lock.releaseLock(); }
}
/* [v7.2] Supabase-backed purchase register. Key lives in Script Properties (VT_SB_KEY),
   never in the browser. RLS not required — service_role key is used server-side only.
   GET ?api=register&offset=0&limit=1000  →  { ok, rows:[...], done }  (paged) */
var SB_URL   = 'https://kssydapdfmkfufrqhwzp.supabase.co';
var SB_TABLE = 'purchase_bill_data';
function apiRegisterSb_(params){   // [2.5] renamed — was apiRegister_ (clashed with RegisterApi.gs)
  var key;
  try{ key = PropertiesService.getScriptProperties().getProperty('VT_SB_KEY'); }catch(e){}
  if(!key) return { ok:false, error:'VT_SB_KEY not set in Script Properties. Add the Supabase service_role key there.' };
  var offset = Math.max(0, parseInt((params&&params.offset)||'0',10)||0);
  var limit  = Math.min(1000, Math.max(1, parseInt((params&&params.limit)||'1000',10)||1000));
  var url = SB_URL.replace(/\/+$/,'') + '/rest/v1/' + SB_TABLE +
    '?select=*&order=id.asc&offset=' + offset + '&limit=' + limit;
  var res = UrlFetchApp.fetch(url, {
    method:'get', muteHttpExceptions:true,
    headers:{ apikey:key, Authorization:'Bearer '+key, Accept:'application/json' }
  });
  var code = res.getResponseCode();
  if(code<200||code>=300) return { ok:false, error:'Supabase HTTP '+code+' '+String(res.getContentText()).slice(0,180) };
  var rows;
  try{ rows = JSON.parse(res.getContentText()); }catch(e){ return { ok:false, error:'bad JSON from Supabase' }; }
  if(!Array.isArray(rows)) rows = [];
  return { ok:true, offset:offset, count:rows.length, done: rows.length < limit, rows:rows };
}
function doPost(e){
  var body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch(_){}
  return handleApi_(body.api || 'record', (e && e.parameter) || {}, body);
}
function handleApi_(api, params, body){
  var token = (body && body.token) || params.token || '';
  if (token !== apiToken_()) {
    return json_({ ok:false, error:'unauthorized',
      hint:'The token in the dashboard does not match VT_API_TOKEN in this script. Run setupLiveApi() once, or set it under Project Settings > Script properties.' });
  }
  try {
    if (api === 'ping') return json_({ ok:true, version:APP_VERSION, time:new Date(), hasRegisterApi:(typeof apiRegisterSb_==='function'), hasRegisterSheet:(typeof apiRegister_==='function'),
      v11:(typeof V11_VERSION!=='undefined'?V11_VERSION:'') });   // [V1.1-01]
    if (api === 'data' || api === 'requests') return json_(apiData_());
    if (api === 'record') return json_(apiRecord_(body));
    if (api === 'receive') return json_(apiReceive_(body));
    if (api === 'meta') return json_(apiMeta_(body));
    if (api === 'security') return json_(apiSecurity_(body, params));
    if (api === 'suppliers') return json_({ ok:true, suppliers:readSuppliers_() });
    if (api === 'lot') return json_(apiLot_(body));
    if (api === 'writeSheet') return json_(apiWriteSheet_(body));
    if (api === 'lotDelete') return json_(apiLotDelete_(body));
    if (api === 'audit') return json_(apiAudit_(body));
    if (api === 'archive') return json_(apiArchive_());
    if (api === 'shipment') return json_((typeof apiShipment_==='function')?v11Wrap_(apiShipment_(body)):{ok:false,error:'ShipmentApi.gs not installed'});             // [V1.1-01]
    if (api === 'shipmentArrive') return json_((typeof apiShipmentArrive_==='function')?v11Wrap_(apiShipmentArrive_(body)):{ok:false,error:'ShipmentApi.gs not installed'}); // [2.1]
    if (api === 'bill') return json_((typeof apiBill_==='function')?v11Wrap_(apiBill_(body)):{ok:false,error:'BillApi.gs not installed'});                         // [2.1]
    if (api === 'billStage') return json_((typeof apiBillStage_==='function')?v11Wrap_(apiBillStage_(body)):{ok:false,error:'BillApi.gs not installed'});          // [2.1]
    if (api === 'billUnassign') return json_((typeof apiBillUnassign_==='function')?v11Wrap_(apiBillUnassign_(body)):{ok:false,error:'BillApi.gs not installed'}); // [2.1]
    if (api === 'billDelete') return json_((typeof apiBillDelete_==='function')?v11Wrap_(apiBillDelete_(body)):{ok:false,error:'BillApi.gs not installed'});       // [2.1]
    if (api === 'shipmentRecode') return json_((typeof apiShipmentRecode_==='function')?v11Wrap_(apiShipmentRecode_(body)):{ok:false,error:'ShipmentTools.gs not installed'}); // [V1.1.2 R37]
    if (api === 'v11data') return json_(v11Payload_());                          // [2.3] fast V1.1-only refresh
    if (api === 'poDelete') return json_((typeof apiPoDelete_==='function')?apiPoDelete_(body):{ok:false,error:'ShipmentApi.gs not installed'});        // [2.2]
    if (api === 'shipmentDelete') return json_((typeof apiShipmentDelete_==='function')?v11Wrap_(apiShipmentDelete_(body)):{ok:false,error:'ShipmentApi.gs not installed'}); // [V1.1-01]
    if (api === 'register') {                                                    // [2.5] route by parameters
      var wantsSheet = params.meta != null || params.from != null || params.sinceId != null;
      if (!wantsSheet) return json_(apiRegisterSb_(params));
      return json_((typeof apiRegister_==='function')?apiRegister_(params):{ok:false,error:'RegisterApi.gs not installed'});
    }
    return json_({ ok:false, error:'unknown api: '+api });
  } catch(err){ return json_({ ok:false, error:String(err && err.message || err) }); }
}
// [2.5] attach the fresh V1.1 data to a successful V1.1 write, so the dashboard needs no second call
function v11Payload_(){ return { ok:true, v11:(typeof V11_VERSION!=='undefined'?V11_VERSION:''),
  shipments:(typeof shpReadShipments_==='function'?shpReadShipments_():[]), shipAllocs:(typeof shpReadAllocs_==='function'?shpReadAllocs_():[]),
  bills:(typeof billReadBills_==='function'?billReadBills_():[]), billLines:(typeof billReadLines_==='function'?billReadLines_():[]) }; }
function v11Wrap_(res){ try{ if(res && res.ok) res.v11data = v11Payload_(); }catch(e){} return res; }
function json_(o){
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function apiData_(){
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var req = ss.getSheetByName(TABS.REQ), requests = [];
  if (req && req.getLastRow() > 1){
    var v = req.getRange(2,1,req.getLastRow()-1,REQ_HEADERS.length).getValues();
    for (var i=0;i<v.length;i++){ var r=v[i]; if(!r[0]) continue;
      requests.push({ lineId:String(r[0]), po:String(r[1]), dt:String(r[2]), user:String(r[3]),
        requestType:String(r[4]), urgency:String(r[5]), newProduct:String(r[6]),
        code:String(r[7]), name:String(r[8]), qty:Number(r[9])||0,
        lineComment:String(r[10]), subComment:String(r[11]), status:String(r[12]||'Pending') });
    }
  }
  var tracking = readTrack_();
  var receipts = readRecv_();
  var closedIds = [], cl = ss.getSheetByName(CLOSED_TAB);
  if (cl && cl.getLastRow() > 1){
    var cv = cl.getRange(2,1,cl.getLastRow()-1,1).getValues();
    for (var k=0;k<cv.length;k++){ if(cv[k][0]) closedIds.push(String(cv[k][0])); }
  }
  return { ok:true, version:APP_VERSION, time:new Date(),
    products:getProducts(), statuses:getStatuses(),
    requests:requests, tracking:tracking, receipts:receipts, closedLineIds:closedIds,
    poMeta:readMeta_(), security:getSecurity_(), suppliers:readSuppliers_(), lots:readLots_(), lotLines:readLotLines_(),
    shipments:(typeof shpReadShipments_==='function'?shpReadShipments_():[]),     // [V1.1-01]
    shipAllocs:(typeof shpReadAllocs_==='function'?shpReadAllocs_():[]),           // [V1.1-01]
    bills:(typeof billReadBills_==='function'?billReadBills_():[]),                // [2.1]
    billLines:(typeof billReadLines_==='function'?billReadLines_():[]) };          // [2.1]
}

function readTrack_(){
  var ss = SpreadsheetApp.getActiveSpreadsheet(), tr = ss.getSheetByName(TRACK_TAB), out=[];
  if (!tr || tr.getLastRow() < 2) return out;
  var n = TRACK_HEADERS.length;
  var tv = tr.getRange(2,1,tr.getLastRow()-1,n).getValues();
  for (var j=0;j<tv.length;j++){ var t=tv[j]; if(!t[1] && !t[2]) continue;
    out.push({ loggedAt:String(t[0]), poLineKey:String(t[1]), lineId:String(t[2]), po:String(t[3]),
      code:String(t[4]), name:String(t[5]), lane:String(t[6]), poNumber:String(t[7]),
      realNo:String(t[8]), poQty:Number(t[9])||0, poStatus:String(t[10]||''),
      parentPo:String(t[11]||''), sentAt:String(t[12]||''), expected:String(t[13]||''), by:String(t[14]||''),
      supplier:String(t[15]||''), shipQty:(t[16]===''||t[16]==null)?'':(Number(t[16])||0), lineNote:String(t[17]||'') });
  }
  return out;
}
function readRecv_(){
  var ss = SpreadsheetApp.getActiveSpreadsheet(), rs = ss.getSheetByName(RECV_TAB), out=[];
  if (!rs || rs.getLastRow() < 2) return out;
  var n = RECV_HEADERS.length;
  var rv = rs.getRange(2,1,rs.getLastRow()-1,n).getValues();
  for (var j=0;j<rv.length;j++){ var r=rv[j]; if(!r[1]) continue;
    out.push({ loggedAt:String(r[0]), recvId:String(r[1]), poNumber:String(r[2]), realNo:String(r[3]),
      lineId:String(r[4]), code:String(r[5]), name:String(r[6]), lane:String(r[7]),
      recvQty:Number(r[8])||0, price:Number(r[9])||0, billNo:String(r[10]), date:String(r[11]), by:String(r[12]||'') });
  }
  return out;
}

function trackSheet_(){
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tr = ss.getSheetByName(TRACK_TAB) || ss.insertSheet(TRACK_TAB);
  if (tr.getLastRow() === 0){
    tr.getRange(1,1,1,TRACK_HEADERS.length).setValues([TRACK_HEADERS]).setFontWeight('bold');
    tr.setFrozenRows(1);
  }
  return tr;
}

// record: upsert PO Tracking rows by PO Line Key; optional removePoNumbers deletes a PO's rows first
function apiRecord_(body){
  var rows = (body && body.rows) || [];
  var removeList = (body && body.removePoNumbers) || [];
  if (!rows.length && !removeList.length) return { ok:false, error:'no rows' };
  var tr = trackSheet_();
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    if (removeList.length && typeof shpPoUse_ === 'function') {                 // [V1.1 2.2] protect shipped POs
      var use = shpPoUse_(), bl = removeList.filter(function (po) { return use[String(po)]; });
      if (bl.length) return { ok:false, error:'PO ' + bl.join(', ') + ' is on a V1.1 shipment — it cannot be removed or split.' };
    }
    var n = TRACK_HEADERS.length;
    // 1) delete rows whose PO Number is in removeList (split parent replacement)
    if (removeList.length && tr.getLastRow() > 1){
      var rmSet = {}; for (var a=0;a<removeList.length;a++) rmSet[String(removeList[a])]=true;
      var all = tr.getRange(2,1,tr.getLastRow()-1,n).getValues();
      for (var d=all.length-1; d>=0; d--){ if (rmSet[String(all[d][7])]) tr.deleteRow(d+2); }
    }
    // 2) index existing by PO Line Key (col 2)
    var existing = {};
    if (tr.getLastRow() > 1){
      var ev = tr.getRange(2,2,tr.getLastRow()-1,1).getValues();
      for (var i=0;i<ev.length;i++){ if(ev[i][0]) existing[String(ev[i][0])] = i+2; }
    }
    var now=new Date(), by=String(body.by||'dashboard'), appends=[], updated=0;
    for (var r=0;r<rows.length;r++){
      var x = rows[r];
      var key = String(x.poLineKey || (String(x.poNumber||'')+'|'+String(x.lineId||'')));
      var rowVals = [now, key, String(x.lineId||''), String(x.po||''), String(x.code||''),
        String(x.name||''), String(x.lane||''), String(x.poNumber||''), String(x.realNo||''),
        Number(x.poQty)||0, String(x.poStatus||'PO Created'), String(x.parentPo||''),
        String(x.sentAt||''), String(x.expected||''), by,
        String(x.supplier||''), (x.shipQty===''||x.shipQty==null)?'':(Number(x.shipQty)||0), String(x.lineNote||'')];
      if (existing[key]){ tr.getRange(existing[key],1,1,n).setValues([rowVals]); updated++; }
      else { appends.push(rowVals); }
      if (x.lineId && body.setStatus){ try { setLineStatus(x.lineId, body.setStatus); } catch(_){} }
    }
    if (appends.length) tr.getRange(tr.getLastRow()+1,1,appends.length,n).setValues(appends);
    return { ok:true, added:appends.length, updated:updated, removed:removeList.length };
  } finally { lock.releaseLock(); }
}

// receive: append material-inward rows + update the PO's tracking status
function apiReceive_(body){
  var rows = (body && body.rows) || [];
  if (!rows.length) return { ok:false, error:'no rows' };
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var rs = ss.getSheetByName(RECV_TAB) || ss.insertSheet(RECV_TAB);
  if (rs.getLastRow() === 0){
    rs.getRange(1,1,1,RECV_HEADERS.length).setValues([RECV_HEADERS]).setFontWeight('bold');
    rs.setFrozenRows(1);
  }
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var now=new Date(), by=String(body.by||'dashboard'), out=[];
    for (var r=0;r<rows.length;r++){ var x=rows[r];
      out.push([now, String(x.recvId||''), String(x.poNumber||''), String(x.realNo||''), String(x.lineId||''),
        String(x.code||''), String(x.name||''), String(x.lane||''), Number(x.recvQty)||0, Number(x.price)||0,
        String(x.billNo||''), String(x.date||''), by]);
    }
    if (out.length) rs.getRange(rs.getLastRow()+1,1,out.length,RECV_HEADERS.length).setValues(out);
    // update PO Tracking status for this PO Number
    if (body.poNumber && body.poStatus){
      var tr = ss.getSheetByName(TRACK_TAB);
      if (tr && tr.getLastRow() > 1){
        var n = TRACK_HEADERS.length, tv = tr.getRange(2,1,tr.getLastRow()-1,n).getValues();
        for (var i=0;i<tv.length;i++){ if (String(tv[i][7])===String(body.poNumber)){
          tr.getRange(i+2,11,1,1).setValue(String(body.poStatus));
        }}
      }
    }
    // optionally flip the request line status
    for (var s=0;s<rows.length;s++){ var y=rows[s];
      if (y.lineId && body.setStatus){ try { setLineStatus(y.lineId, body.setStatus); } catch(_){} }
    }
    return { ok:true, added:out.length };
  } finally { lock.releaseLock(); }
}

/* ===================== [v3] PO META (PO-level follow-up state) ===================== */
function metaSheet_(){
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var m = ss.getSheetByName(META_TAB) || ss.insertSheet(META_TAB);
  if (m.getLastRow() === 0){ m.getRange(1,1,1,META_HEADERS.length).setValues([META_HEADERS]).setFontWeight('bold'); m.setFrozenRows(1); }
  return m;
}
function readMeta_(){
  var ss = SpreadsheetApp.getActiveSpreadsheet(), m = ss.getSheetByName(META_TAB), out=[];
  if (!m || m.getLastRow() < 2) return out;
  var n = META_HEADERS.length, v = m.getRange(2,1,m.getLastRow()-1,n).getValues();
  for (var i=0;i<v.length;i++){ var r=v[i]; if(!r[0]) continue;
    var notes=[]; try { notes = r[6] ? JSON.parse(r[6]) : []; } catch(_){ notes=[]; }
    out.push({ poNumber:String(r[0]), supplier:String(r[1]||''), approvedAt:String(r[2]||''),
      billAt:String(r[3]||''), promised:String(r[4]||''), snoozeUntil:String(r[5]||''),
      notes:notes, updatedAt:String(r[7]||''), by:String(r[8]||''),
      closedAt:String(r[9]||''), closedBy:String(r[10]||''), cancelReason:String(r[11]||''), cancelledAt:String(r[12]||''), realNo:String(r[13]||'') });
  }
  return out;
}
// meta: upsert one PO Meta row by PO Number
function apiMeta_(body){
  var poNumber = String((body && body.poNumber) || '');
  if (!poNumber) return { ok:false, error:'no poNumber' };
  var m = metaSheet_(), n = META_HEADERS.length;
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var rowIx = 0;
    if (m.getLastRow() > 1){
      var keys = m.getRange(2,1,m.getLastRow()-1,1).getValues();
      for (var i=0;i<keys.length;i++){ if (String(keys[i][0])===poNumber){ rowIx = i+2; break; } }
    }
    var notesJson = '';
    try { notesJson = JSON.stringify((body && body.notes) || []); } catch(_){ notesJson = '[]'; }
    // read existing row so fields not supplied in this call are preserved, not blanked
    var cur = rowIx ? m.getRange(rowIx,1,1,n).getValues()[0] : [];
    function keep(ix, v){ return (v===undefined||v===null) ? String(cur[ix]||'') : String(v); }
    var vals = [poNumber, keep(1,body.supplier), keep(2,body.approvedAt), keep(3,body.billAt),
      keep(4,body.promised), keep(5,body.snoozeUntil),
      (body.notes!==undefined ? notesJson : (cur[6]||'[]')), new Date(), String(body.by||'dashboard'),
      keep(9,body.closedAt), keep(10,body.closedBy), keep(11,body.cancelReason), keep(12,body.cancelledAt), keep(13,body.realNo)];
    if (rowIx) m.getRange(rowIx,1,1,n).setValues([vals]);
    else m.getRange(m.getLastRow()+1,1,1,n).setValues([vals]);
    return { ok:true, poNumber:poNumber, upserted:true };
  } finally { lock.releaseLock(); }
}

/* ===================== [v3] SECURITY — sheet-shared PIN hashes (Script Properties) ===================== */
function getSecurity_(){
  var p = PropertiesService.getScriptProperties();
  return { salt: p.getProperty('VT_PIN_SALT')||'', followHash: p.getProperty('VT_PIN_FOLLOW')||'', mgmtHash: p.getProperty('VT_PIN_MGMT')||'' };
}
// security: GET returns hashes; POST sets a tier hash (authorised by current mgmt hash, or bootstrap when none set)
function apiSecurity_(body, params){
  var cur = getSecurity_();
  var isGet = !(body && body.set);
  if (isGet) return { ok:true, salt:cur.salt, followHash:cur.followHash, mgmtHash:cur.mgmtHash };
  var tier = String(body.set||''), hash = String(body.hash||''), auth = String(body.authHash||''), salt = String(body.salt||'');
  if (tier !== 'followup' && tier !== 'mgmt') return { ok:false, error:'bad tier' };
  // authorise: if a mgmt hash already exists, the caller must supply it; otherwise this is first-time bootstrap
  if (cur.mgmtHash && auth !== cur.mgmtHash) return { ok:false, error:'auth failed' };
  var p = PropertiesService.getScriptProperties();
  if (salt) p.setProperty('VT_PIN_SALT', salt);
  p.setProperty(tier==='mgmt' ? 'VT_PIN_MGMT' : 'VT_PIN_FOLLOW', hash);
  return { ok:true, saved:tier };
}

/* ===================== [v3] SUPPLIERS (Management-only contacts) ===================== */
// Suppliers live in a SEPARATE sheet; map columns by header so order/extra columns don't matter.
var SUP_SHEET_ID = '1Uc2ba4AjU_0ojhoyhkHtfvAK0tJtgmWbI7xOGBpV3VY';
function readSuppliers_(){
  var out=[];
  try{
    var ss = SUP_SHEET_ID ? SpreadsheetApp.openById(SUP_SHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
    var sh = SUP_SHEET_ID ? ss.getSheets()[0] : ss.getSheetByName(SUP_TAB);
    if (!sh || sh.getLastRow() < 2) return out;
    var vals = sh.getRange(1,1,sh.getLastRow(), sh.getLastColumn()).getValues();
    var hdr = vals[0].map(function(h){ return String(h).trim().toLowerCase(); });
    function col(names){ for (var i=0;i<hdr.length;i++){ for (var j=0;j<names.length;j++){ if (hdr[i].indexOf(names[j])>=0) return i; } } return -1; }
    var iName=col(['name']), iPhone=col(['contact','mobile','phone']), iWa=col(['whatsapp','whats app']), iGst=col(['gstin','gst']), iLead=col(['lead']);
    if (iName < 0) iName = 1;  // fall back to 2nd column (Sr.No · Name · …)
    for (var r=1; r<vals.length; r++){
      var row = vals[r], nm = String(row[iName]||'').trim();
      if (!nm) continue;
      out.push({ name:nm, phone:iPhone>=0?String(row[iPhone]||'').trim():'', whatsapp:iWa>=0?String(row[iWa]||'').trim():'',
        gstin:iGst>=0?String(row[iGst]||'').trim():'', leadDays:iLead>=0?(Number(row[iLead])||0):0, lane:'', notes:'' });
    }
  } catch(e){ return [{ _error:String(e && e.message || e) }]; }
  return out;
}

/* ===================== [v4] LOTS — a lot is a real shipment; split lives on its lines ===================== */
function lotsSheet_(){var ss=SpreadsheetApp.getActiveSpreadsheet();var s=ss.getSheetByName(LOTS_TAB)||ss.insertSheet(LOTS_TAB);
  if(s.getLastRow()===0){s.getRange(1,1,1,LOTS_HEADERS.length).setValues([LOTS_HEADERS]).setFontWeight('bold').setBackground('#2563EB').setFontColor('#FFF');s.setFrozenRows(1);}return s;}
function lotlSheet_(){var ss=SpreadsheetApp.getActiveSpreadsheet();var s=ss.getSheetByName(LOTL_TAB)||ss.insertSheet(LOTL_TAB);
  if(s.getLastRow()===0){s.getRange(1,1,1,LOTL_HEADERS.length).setValues([LOTL_HEADERS]).setFontWeight('bold').setBackground('#1F6B7A').setFontColor('#FFF');s.setFrozenRows(1);}return s;}
function auditSheet_(){var ss=SpreadsheetApp.getActiveSpreadsheet();var s=ss.getSheetByName(AUDIT_TAB)||ss.insertSheet(AUDIT_TAB);
  if(s.getLastRow()===0){s.getRange(1,1,1,AUDIT_HEADERS.length).setValues([AUDIT_HEADERS]).setFontWeight('bold').setBackground('#444').setFontColor('#FFF');s.setFrozenRows(1);}return s;}
// [V1.1.2 R09] lots converted into V1.1 shipments carry the shipment ID in column U ("Converted To").
// They are hidden from every lot reader, so nothing is counted twice. Clearing column U brings a lot back.
var LOT_CONV_COL = 21;
function lotConvSet_(){
  var out={};
  try{var s=SpreadsheetApp.getActiveSpreadsheet().getSheetByName(LOTS_TAB);
    if(!s||s.getLastRow()<2||s.getMaxColumns()<LOT_CONV_COL)return out;
    var v=s.getRange(2,1,s.getLastRow()-1,LOT_CONV_COL).getValues();
    for(var i=0;i<v.length;i++)if(v[i][0]&&String(v[i][LOT_CONV_COL-1]||'').trim())out[String(v[i][0])]=String(v[i][LOT_CONV_COL-1]);
  }catch(e){}
  return out;
}
function readLots_(){
  var ss=SpreadsheetApp.getActiveSpreadsheet(),s=ss.getSheetByName(LOTS_TAB),out=[];
  if(!s||s.getLastRow()<2)return out;
  var conv=lotConvSet_();                                                      // [V1.1.2 R09]
  var v=s.getRange(2,1,s.getLastRow()-1,LOTS_HEADERS.length).getValues();
  for(var i=0;i<v.length;i++){var r=v[i];if(!r[0]||conv[String(r[0])])continue;
    out.push({lotId:String(r[0]),poNumber:String(r[1]),lotNo:String(r[2]),date:dstr_(r[3]),transport:String(r[4]||''),lr:String(r[5]||''),
      billG:String(r[6]||''),billN:String(r[7]||''),miReadyAt:dstr_(r[8]),receivedAt:dstr_(r[9]),uploadedAt:dstr_(r[10]),note:String(r[11]||''),by:String(r[13]||''),expected:dstr_(r[14]),
      vasyBill:String(r[15]||''),roundG:Number(r[16])||0,roundN:Number(r[17])||0,chargesJson:String(r[18]||''),totalsJson:String(r[19]||'')});}
  return out;
}
function readLotLines_(){
  var ss=SpreadsheetApp.getActiveSpreadsheet(),s=ss.getSheetByName(LOTL_TAB),out=[];
  if(!s||s.getLastRow()<2)return out;
  var conv=lotConvSet_();                                                      // [V1.1.2 R09]
  var v=s.getRange(2,1,s.getLastRow()-1,LOTL_HEADERS.length).getValues();
  for(var i=0;i<v.length;i++){var r=v[i];if(!r[0]||conv[String(r[0])])continue;
    out.push({lotId:String(r[0]),poNumber:String(r[1]),i:(r[2]===''?-1:Number(r[2])),code:String(r[3]||''),name:String(r[4]||''),
      qty:Number(r[5])||0,g:(r[6]===''||r[6]==null)?null:Number(r[6]),n:(r[7]===''||r[7]==null)?null:Number(r[7]),
      rate:Number(r[8])||0,tax:Number(r[9])||0,upName:String(r[10]).toLowerCase()==='true'||r[10]===true,
      mrp:(r[11]===''?null:Number(r[11])),sp:(r[12]===''?null:Number(r[12])),ret:Number(r[13])||0,
      flags:String(r[14]||'').split(',').map(function(x){return x.trim();}).filter(String)});}
  return out;
}
function dstr_(v){if(v==null||v==='')return '';if(Object.prototype.toString.call(v)==='[object Date]'){var d=v;return d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2);}return String(v);}
// upsert one lot (+its lines). Server assigns the human lot number on first sync.
function apiLot_(body){
  var lot=(body&&body.lot)||null;if(!lot||!lot.lotId||!lot.poNumber)return {ok:false,error:'no lot'};
  var by=String((body&&body.by)||'dashboard');
  var lock=LockService.getScriptLock();lock.waitLock(20000);
  try{
    var s=lotsSheet_(),sl=lotlSheet_();
    var lotNo=String(lot.lotNo||'');
    var rowIx=0,maxNo=0;
    if(s.getLastRow()>1){
      var keys=s.getRange(2,1,s.getLastRow()-1,3).getValues();
      for(var i=0;i<keys.length;i++){
        if(String(keys[i][0])===String(lot.lotId))rowIx=i+2;
        if(String(keys[i][1])===String(lot.poNumber)){var nn=parseInt(keys[i][2],10);if(nn>maxNo)maxNo=nn;}
      }
    }
    var _conv=lotConvSet_();if(_conv[String(lot.lotId)])                          // [V1.1.2 R09]
      return {ok:false,locked:true,error:'This old lot was converted into shipment '+_conv[String(lot.lotId)]+'. Edit it in the Shipments tab.'};
    if(!rowIx&&typeof v11LotLocked_==='function'&&v11LotLocked_())   // [V1.1 2.1] old-lot lock
      return {ok:false,locked:true,error:'New lots are switched off. Please use the new V1.1 dashboard file and record shipments in the Shipments tab. (Existing lots can still be edited.)'};
    if(!rowIx&&(!lotNo||lot.localNo))lotNo=('0'+(maxNo+1)).slice(-2);   // [v4.2] server-assigned 2-digit, in sync order
    if(rowIx&&!lotNo){lotNo=String(s.getRange(rowIx,3).getValue()||('0'+(maxNo+1)).slice(-2));}
    var vals=[lot.lotId,lot.poNumber,lotNo,String(lot.date||''),String(lot.transport||''),String(lot.lr||''),
      String(lot.billG||''),String(lot.billN||''),String(lot.miReadyAt||''),String(lot.receivedAt||''),String(lot.uploadedAt||''),String(lot.note||''),new Date(),by,String(lot.expected||''),
      String(lot.vasyBill||''),Number(lot.roundG)||0,Number(lot.roundN)||0,String(lot.chargesJson||''),String(lot.totalsJson||'')];
    if(rowIx)s.getRange(rowIx,1,1,LOTS_HEADERS.length).setValues([vals]);
    else s.getRange(s.getLastRow()+1,1,1,LOTS_HEADERS.length).setValues([vals]);
    // replace this lot's lines
    if(sl.getLastRow()>1){
      var lv=sl.getRange(2,1,sl.getLastRow()-1,1).getValues();
      for(var j=lv.length-1;j>=0;j--){if(String(lv[j][0])===String(lot.lotId))sl.deleteRow(j+2);}
    }
    var lines=(lot.lines||[]);
    if(lines.length){
      var rows=lines.map(function(x){return [lot.lotId,lot.poNumber,(x.i==null?-1:x.i),String(x.code||''),String(x.name||''),
        Number(x.qty)||0,(x.g==null?'':Number(x.g)),(x.n==null?'':Number(x.n)),Number(x.rate)||0,Number(x.tax)||0,
        !!x.upName,(x.mrp==null?'':Number(x.mrp)),(x.sp==null?'':Number(x.sp)),Number(x.ret)||0,(x.flags||[]).join(','),new Date(),by];});
      sl.getRange(sl.getLastRow()+1,1,rows.length,LOTL_HEADERS.length).setValues(rows);
    }
    audit_(by,'LOT_UPSERT','Lot',lot.lotId,'','',lotNo,lot.poNumber);
    return {ok:true,lotId:lot.lotId,lotNo:lotNo};
  } finally { lock.releaseLock(); }
}
/* [v5.7] delete a lot and its lines — otherwise the next sync pulled a deleted lot back */
function apiLotDelete_(body){
  var lotId = String((body && body.lotId) || ''); if (!lotId) return { ok:false, error:'no lotId' };
  var by = String((body && body.by) || 'dashboard');
  var _cv = lotConvSet_(); if (_cv[lotId]) return { ok:false, error:'This old lot was converted into shipment '+_cv[lotId]+' — delete the shipment instead.' };   // [V1.1.2 R09]
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet(), n = 0;
    var s = ss.getSheetByName(LOTS_TAB);
    if (s && s.getLastRow() > 1) {
      var v = s.getRange(2, 1, s.getLastRow() - 1, 1).getValues();
      for (var i = v.length - 1; i >= 0; i--) if (String(v[i][0]) === lotId) { s.deleteRow(i + 2); n++; }
    }
    var sl = ss.getSheetByName(LOTL_TAB);
    if (sl && sl.getLastRow() > 1) {
      var w = sl.getRange(2, 1, sl.getLastRow() - 1, 1).getValues();
      for (var j = w.length - 1; j >= 0; j--) if (String(w[j][0]) === lotId) { sl.deleteRow(j + 2); n++; }
    }
    audit_(by, 'LOT_DELETE', 'Lot', lotId, '', '', 'deleted', String((body && body.poNumber) || ''));
    return { ok:true, removed:n };
  } finally { lock.releaseLock(); }
}
/* ===================== [v4] AUDIT — append-only ===================== */
function audit_(user,action,entity,id,field,oldV,newV,note){
  try{var s=auditSheet_();s.getRange(s.getLastRow()+1,1,1,AUDIT_HEADERS.length)
    .setValues([[new Date(),String(user||''),String(action||''),String(entity||''),String(id||''),String(field||''),String(oldV||''),String(newV||''),String(note||'')]]);}catch(e){}
}
function apiAudit_(body){
  var e=(body&&body.entries)||[];var by=String((body&&body.by)||'dashboard');
  for(var i=0;i<e.length;i++){var x=e[i]||{};audit_(x.user||by,x.action,x.entity,x.id,x.field,x.oldV,x.newV,x.note);}
  return {ok:true,logged:e.length};
}
/* ===================== [v4] ARCHIVE — move fully-closed POs older than 60 days ===================== */
function apiArchive_(){return {ok:true,archived:archiveClosed()};}
function archiveClosed(){
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  var arch=ss.getSheetByName(ARCH_TAB)||ss.insertSheet(ARCH_TAB);
  if(arch.getLastRow()===0){arch.getRange(1,1).setValue('Archived rows (PO Tracking / Lots / Lot Lines) — appended with source tab as first column');}
  var cutoff=new Date();cutoff.setDate(cutoff.getDate()-60);
  var lots=readLots_(),lotl=readLotLines_();
  // a PO is archivable when every one of its lots is received AND the newest activity is older than 60 days
  var byPo={};lots.forEach(function(L){(byPo[L.poNumber]=byPo[L.poNumber]||[]).push(L);});
  var t=ss.getSheetByName(TRACK_TAB);var closed={};
  if(t&&t.getLastRow()>1){
    var tv=t.getRange(2,1,t.getLastRow()-1,TRACK_HEADERS.length).getValues();
    var poRows={};
    tv.forEach(function(r,ix){var po=String(r[7]||'');if(!po)return;(poRows[po]=poRows[po]||[]).push({ix:ix+2,r:r});});
    Object.keys(poRows).forEach(function(po){
      var rows=poRows[po];var allRecv=rows.every(function(x){return String(x.r[10]||'')==='Received';});
      var Ls=byPo[po]||[];var lotsDone=Ls.every(function(L){return !!L.receivedAt;});
      var newest=rows.reduce(function(a,x){var d=new Date(x.r[0]);return d>a?d:a;},new Date(0));
      Ls.forEach(function(L){var d=new Date(L.date||0);if(d>newest)newest=d;});
      if(allRecv&&lotsDone&&newest<cutoff)closed[po]=rows.map(function(x){return x.ix;});
    });
    var n=0;
    var pos=Object.keys(closed);
    pos.forEach(function(po){
      closed[po].sort(function(a,b){return b-a;}).forEach(function(ix){
        arch.appendRow(['PO Tracking'].concat(t.getRange(ix,1,1,TRACK_HEADERS.length).getValues()[0]));t.deleteRow(ix);n++;});
      var s=ss.getSheetByName(LOTS_TAB);if(s&&s.getLastRow()>1){
        var v=s.getRange(2,1,s.getLastRow()-1,LOTS_HEADERS.length).getValues();
        for(var j=v.length-1;j>=0;j--){if(String(v[j][1])===po){arch.appendRow(['Lots'].concat(v[j]));s.deleteRow(j+2);n++;}}}
      var sl=ss.getSheetByName(LOTL_TAB);if(sl&&sl.getLastRow()>1){
        var w=sl.getRange(2,1,sl.getLastRow()-1,LOTL_HEADERS.length).getValues();
        for(var k=w.length-1;k>=0;k--){if(String(w[k][1])===po){arch.appendRow(['Lot Lines'].concat(w[k]));sl.deleteRow(k+2);n++;}}}
      audit_('system','ARCHIVE','PO',po,'','','','moved to Archive');
    });
    return n;
  }
  return 0;
}