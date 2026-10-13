// V1.1.9: View only / Operations PIN, shipment & bill view-first windows with search + history, overview drill lists,
// board cards, and phase-4 speed-ups (discussed, promise score, escalate, lead time/MOQ + duplicate warning in New PO,
// requests on-order info, bulk send/close, auto expected date, since yesterday, tab count, fix list, menu search)
const fs=require('fs');const {JSDOM,VirtualConsole}=require('jsdom');
const html=fs.readFileSync('VT_Purchase_Intelligence_V1_1.html','utf8').replace(/<script[^>]*src=[^>]*><\/script>/g,'');
const vc=new VirtualConsole();const errs=[];vc.on('jsdomError',e=>errs.push(String(e.message||e)));
const dom=new JSDOM(html,{runScripts:'dangerously',virtualConsole:vc,url:'https://x.test/',beforeParse(w){w.__al=[];w.alert=m=>w.__al.push(String(m));w.__cf=true;w.confirm=()=>w.__cf;}});
const w=dom.window;setTimeout(async()=>{const ev=c=>w.eval(c);
 ev(`liveSync=async()=>{};document.getElementById('btn-ops').click();
  window.__posts=[];VT_LIVE.url='https://x.test/exec';VT_LIVE.token='t';
  vtApiPost=(function(orig){return async b=>{if(VT_VIEW&&!(b&&(VT_READ_API.has(b.api)||(b.api==='security'&&!b.set)))){vtViewMsg();return {ok:false,error:'View only'};}
    __posts.push(b);if(b.api==='history')return {ok:true,history:[{at:'2026-10-14 10:05',user:'Ravi',action:'SHIPMENT_UPSERT',oldV:'updated',note:'2 allocation(s) · changed: LR "" → "LR77"'},{at:'2026-10-13 09:00',user:'Anu',action:'SHIPMENT_UPSERT',oldV:'',note:'2 allocation(s)'}]};return {ok:true};};})(vtApiPost);
  const T=t8(),D=n=>d8add(T,n);
  PRODUCTS=new Map([['A',{name:'Alpha'}],['B',{name:'Beta'}],['C',{name:'Gamma'}]]);
  PODOCS=[{poId:'PO-1',realNo:'PO-1',lane:'g',status:'sent',createdAt:D(-20),sentAt:D(-19),supplier:'Zeta Ltd',lines:[{code:'A',name:'Alpha',qty:10,price:100},{code:'B',name:'Beta',qty:10,price:0}],lots:[],
       notes:[{kind:'call',outcome:'promised',date:D(-15),at:D(-18)+' 10:00',text:'p',done:true},{kind:'call',outcome:'promised',date:D(-10),at:D(-12)+' 10:00',text:'p',done:true}]},
    {poId:'PO-2',realNo:'PO-2',lane:'g',status:'sent',createdAt:D(-9),sentAt:D(-8),supplier:'Acme',lines:[{code:'C',name:'Gamma',qty:5,price:50}],lots:[],
       notes:[{kind:'call',outcome:'noanswer',at:D(-3)+' 10:00',done:true},{kind:'call',outcome:'noanswer',at:D(-2)+' 10:00',done:true},{kind:'call',outcome:'noanswer',at:D(-1)+' 10:00',done:true}]},
    {poId:'PO-3',realNo:'PO-3',lane:'n',status:'made',createdAt:D(0),supplier:'Acme',lines:[{code:'A',name:'Alpha',qty:2,price:100}],lots:[]},
    {poId:'PO-4',realNo:'PO-4',lane:'g',status:'sent',createdAt:D(-40),sentAt:D(-40),supplier:'Zeta Ltd',lines:[{code:'C',name:'Gamma',qty:2,price:50}],lots:[]},
    {poId:'PO-5',realNo:'',lane:'g',status:'made',createdAt:D(-1),supplier:'',lines:[{code:'NEW:widget',name:'Widget',qty:2,price:10}],lots:[]}];
  PODOCS.forEach(lotMirror);
  V11={loaded:true,shipments:[{shipmentId:'S1',shipmentNo:'SH-1',supplier:'Zeta Ltd',status:'Arrived',arrivedAt:D(-1),shipDate:D(-3),lr:'LR9',createdAt:D(-3),updatedAt:D(-1),by:'Anu'},
     {shipmentId:'S2',shipmentNo:'SH-2',supplier:'Zeta Ltd',status:'In Transit',shipDate:D(-2),createdAt:D(0)},
     {shipmentId:'S3',shipmentNo:'SH-3',supplier:'Zeta Ltd',status:'Arrived',arrivedAt:D(-20),shipDate:D(-25),lr:'LR1'},
     {shipmentId:'S4',shipmentNo:'SH-4',supplier:'Zeta Ltd',status:'Arrived',arrivedAt:D(-30),shipDate:D(-34),lr:'LR2'}],
   allocs:[{shipmentId:'S1',type:'PO',poNumber:'PO-1',canon:'A',code:'A',name:'Alpha',qty:4},{shipmentId:'S2',type:'PO',poNumber:'PO-1',canon:'B',code:'B',name:'Beta',qty:6},{shipmentId:'S2',type:'OFFPO',poNumber:'',canon:'X',code:'X',name:'Xtra',qty:1},
     {shipmentId:'S3',type:'PO',poNumber:'PO-4',canon:'C',code:'C',name:'Gamma',qty:2},{shipmentId:'S4',type:'PO',poNumber:'PO-4',canon:'C',code:'C',name:'Gamma',qty:0}],
   bills:[{billId:'B1',billNo:'BL-1',supplier:'Zeta Ltd',readyAt:D(-1),supBillG:'',totalsJson:'{"wTotal":400,"nTotal":0}',createdAt:D(-1),updatedAt:D(-1),by:'Anu',chargesJson:'[{"name":"Freight","amount":50,"lane":"g","gst":18}]'}],
   billLines:[{billId:'B1',shipmentId:'S1',canon:'A',code:'A',name:'Alpha',qtyG:4,rateG:100,qtyN:0,rateN:0,tax:18,mrpG:0,spG:0}]};
  v11InjectLots();VT_MODE='followup';acApply();`);
 // ---------- modes ----------
 ev(`acSavePin('ops','1234');`);
 console.log('ops hash set, this PC remembered:',ev(`!!acSecHash('ops')&&acOpsRemembered()`));
 ev(`acEnterView()`);console.log('VIEW: chip',ev(`document.getElementById('mode-chip').textContent`),'| screen:',ev(`NAV_CUR.g+'/'+NAV_CUR.k`),'| New PO in menu:',ev(`navOK('edit')`));
 const p0=ev(`__posts.length`);ev(`(async()=>{await vtApiPost({api:'meta',poNumber:'PO-1'});})()`);await new Promise(r=>setTimeout(r,20));
 console.log('VIEW: write reached server?',ev(`__posts.length`)>p0,'| read allowed:',ev(`(vtApiPost({api:'history',id:'S1'}),true)`));
 ev(`navGo('pos','allpos')`);await new Promise(r=>setTimeout(r,10));console.log('VIEW: locked buttons on All POs:',ev(`document.querySelectorAll('#pos-list .vt-lk').length`),'| Send button locked:',ev(`[...document.querySelectorAll('#pos-list button')].filter(b=>/Send/.test(b.textContent)).every(b=>b.classList.contains('vt-lk'))`));
 ev(`const b=[...document.querySelectorAll('#pos-list button')].find(b=>/Send/.test(b.textContent));b.dispatchEvent(new MouseEvent('click',{bubbles:true}))`);
 console.log('VIEW: click Send → PO-3 still made:',ev(`posStage(podocFind('PO-3'))`),'| outbox:',ev(`VT_OUTBOX.length`));
 ev(`localStorage.removeItem('vt_ops_ok');window.__pinAnswer='9999';askPin=async()=>__pinAnswer;`);
 await ev(`acEnterOps()`);console.log('wrong Operations PIN → still view:',ev(`VT_VIEW`),'| alert:',ev(`__al.slice(-1)[0]`));
 ev(`__pinAnswer='1234'`);await ev(`acEnterOps()`);console.log('right PIN → mode:',ev(`document.getElementById('mode-chip').textContent`),'| remembered:',ev(`acOpsRemembered()`));
 ev(`acBootView()`);console.log('next start on this PC → view?',ev(`VT_VIEW`));
 ev(`v11ShipEditForm('S2')`);await new Promise(r=>setTimeout(r,10));console.log('OPS: delete in shipment editor locked:',ev(`[...document.querySelectorAll('#s11-body button')].filter(b=>/delete/.test(b.textContent)).every(b=>b.classList.contains('vt-lk'))`));ev(`mClose('ship11-modal')`);
 ev(`VT_MODE='followup';VT_VIEW=false;acApply();`);
 // ---------- shipment window ----------
 ev(`v11ShipEdit('S2')`);console.log('SHIP view title:',ev(`document.getElementById('s11-title').textContent.replace(/\\s+/g,' ').trim()`),'| inputs in view:',ev(`document.querySelectorAll('#s11-body input:not([placeholder^="🔍"])').length`),'| rows:',ev(`document.querySelectorAll('#s11-body tr[data-t]').length`));
 ev(`v11SvFind('xtra')`);console.log('search "xtra" → shown:',ev(`[...document.querySelectorAll('#s11-body tr[data-t]')].filter(t=>t.style.display!=='none').map(t=>t.dataset.t).join()`));
 ev(`v11SvFind('');v11SvAll(true)`);console.log('expand all → detail rows:',ev(`document.querySelectorAll('#s11-body tr.sv-x').length`),'| footer:',ev(`[...document.querySelectorAll('#s11-body button')].map(b=>b.textContent.trim()).join(' | ')`));
 await ev(`v11SvHist()`);console.log('history:',ev(`document.getElementById('s11-body').textContent.match(/History[^]*?LR77/)?'shows edit with change':'missing'`));
 ev(`v11ShipEditForm('S2')`);console.log('EDIT form: search box:',ev(`!!document.getElementById('s11-find')`),'| why box:',ev(`!!document.getElementById('s11-why')`),'| back button:',ev(`[...document.querySelectorAll('#s11-body button')].some(b=>/Back to view/.test(b.textContent))`));
 ev(`v11ShipFind('beta')`);console.log('edit search "beta":',ev(`[...document.querySelectorAll('#s11-rows .s11-row')].filter(e=>e.style.display!=='none').length`),'of',ev(`document.querySelectorAll('#s11-rows .s11-row').length`));
 ev(`document.getElementById('s11-why').value='LR added';S11._why='LR added';document.getElementById('s11-lr').value='LR77'`);await ev(`v11ShipSave()`);
 console.log('save sends editNote:',ev(`JSON.stringify(__posts.filter(p=>p.api==='shipment').slice(-1)[0].editNote)`));
 // ---------- bill window ----------
 ev(`v11BillOpen('B1')`);console.log('BILL view: qty inputs',ev(`document.querySelectorAll('#b11-body input[id^="b11-qtyG"]').length`),'| buttons:',ev(`[...document.querySelectorAll('#b11-body button')].map(b=>b.textContent.trim()).filter(t=>/Edit|Save|History|delete/.test(t)).join(' | ')`),'| charges text:',ev(`/Freight · /.test(document.getElementById('b11-body').textContent)`));
 ev(`v11BillEdit()`);console.log('BILL edit: qty inputs',ev(`document.querySelectorAll('#b11-body input[id^="b11-qtyG"]').length`),'| buttons:',ev(`[...document.querySelectorAll('#b11-body button')].map(b=>b.textContent.trim()).filter(t=>/Edit|Save|Back|delete/.test(t)).join(' | ')`));
 ev(`v11BillFind('zzz')`);console.log('bill search "zzz" shown:',ev(`[...document.querySelectorAll('#b11-body tr[data-t]')].filter(t=>t.style.display!=='none').length`));
 ev(`mClose('bill11-modal')`);
 // ---------- overview drill ----------
 ev(`navGo('ships','shipov')`);ev(`ovDrill11('tr')`);console.log('drill "In transit":',ev(`document.getElementById('ovd-title').textContent`),'| rows:',ev(`document.querySelectorAll('#ovd-body .ovrow').length`),'| link:',ev(`/full list/.test(document.getElementById('ovd-body').textContent)`));
 ev(`document.querySelector('#ovd-body .ovrow').click()`);console.log('click row → shipment window:',ev(`document.getElementById('ship11-modal').classList.contains('on')&&/SH-2/.test(document.getElementById('s11-title').textContent)`));
 ev(`mClose('ship11-modal');mClose('ovdrill-modal');navGo('bills','billov');ovDrill11('brm')`);console.log('bill drill "Ready → MI":',ev(`document.querySelectorAll('#ovd-body .ovrow').length`));ev(`mClose('ovdrill-modal')`);
 // ---------- board ----------
 ev(`navGo('track','kanban')`);console.log('board cards:',ev(`document.querySelectorAll('#pos-list .kb-card').length`),'| shipment cards:',ev(`[...document.querySelectorAll('#pos-list .kb-card.ship .kb-no')].map(a=>a.textContent).join()`),'| raw date text?',ev(`/GMT/.test(document.getElementById('pos-list').textContent)`));
 console.log('posDispDate("Tue Oct 13 2026 00:00:00 GMT+0530"):',ev(`posDispDate('Tue Oct 13 2026 00:00:00 GMT+0530 (India Standard Time)')`));
 // ---------- phase 4 ----------
 ev(`navGo('today','askdad')`);
 console.log('promise Zeta:',ev(`JSON.stringify((({kept,broken,avgLate,escalate})=>({kept,broken,avgLate,escalate}))(supPromise('Zeta Ltd')))`),'| Acme escalate:',ev(`supPromise('Acme').escalate+' '+supPromise('Acme').why`));
 console.log('card order:',ev(`[...document.querySelectorAll('#pos-list .ask-card')].map(c=>c.dataset.s).join(' | ')`));
 ev(`askDiscTog(document.querySelector('#pos-list .ask-card[data-s="Acme"] button'))`);
 console.log('after Acme discussed → order:',ev(`[...document.querySelectorAll('#pos-list .ask-card')].map(c=>c.dataset.s+(c.classList.contains('ask-disc')?'(✓)':'')).join(' | ')`),'| progress:',ev(`document.querySelector('#pos-list .ovgrid').textContent.match(/✓ \\d+ of \\d+ discussed/)[0]`));
 ev(`ST.set('Zeta Ltd',new Map([['A',{lt:10,moq:20}],['*',{lt:12,moq:''}]]));LT_IDX={at:0,m:null};
   PO=[{id:901,code:'A',name:'Alpha',supplier:'Zeta Ltd',lane:'g',qty:5,price:100,mrp:0}];navGo('pos','newpo');poRender();`);
 console.log('New PO hints:',ev(`document.getElementById('po-cart').textContent.replace(/\\s+/g,' ').match(/already on order[^·]*|below the supplier's MOQ 20|arrives about [0-9A-Za-z ]+/g).join(' || ')`));
 ev(`window.__cf=false;poCreateRecord('Zeta Ltd','g')`);console.log('duplicate → confirm "no" keeps cart:',ev(`PO.length`));
 ev(`window.__cf=true;poCreateRecord('Zeta Ltd','g')`);console.log('created with expected = today+10:',ev(`PODOCS[0].expected===d8add(t8(),10)`));
 console.log('request extra:',ev(`reqExtraHTML({canon:'C'}).replace(/<[^>]+>/g,'')`));
 ev(`navGo('pos','allpos');fundSelAll(['PO-3','PO-1'])`);console.log('bulk bar:',ev(`document.querySelector('#pos-list .card').textContent.replace(/\\s+/g,' ').trim().slice(0,80)`));
 ev(`apoBulkSent()`);console.log('PO-3 sent:',ev(`posStage(podocFind('PO-3'))`));
 ev(`v11ShipNew();S11.supplier='Zeta Ltd';v11ShipModal()`);console.log('auto expected:',ev(`S11.expected+' '+JSON.stringify(S11._autoExp)`));ev(`mClose('ship11-modal')`);
 ev(`navGo('today','today')`);console.log('since yesterday:',ev(`document.getElementById('pos-list').textContent.match(/Since yesterday:[^\\n]*?(?=\\s{2,}|$)/)[0].replace(/\\s+/g,' ').slice(0,140)`));
 ev(`navBadgeDirty()`);console.log('tab title:',ev(`document.title`));
 ev(`navGo('track','fix')`);console.log('fix list:',ev(`fixBuild().filter(x=>x.rows.length).map(x=>x.k+'='+x.rows.length).join(' ')`));
 ev(`vtQRun('sh-2')`);console.log('search "sh-2":',ev(`[...document.querySelectorAll('#vt-qr .vtq-o')].map(o=>o.textContent.trim().slice(0,30)).join(' | ')`));
 ev(`vtQRun('gamma')`);console.log('search "gamma":',ev(`document.querySelectorAll('#vt-qr .vtq-o').length`),'results');
 ev(`vtQKey({key:'Enter',preventDefault(){}})`);console.log('Enter opens first:',ev(`document.getElementById('po-detail-modal').classList.contains('on')||document.getElementById('ship11-modal').classList.contains('on')`));
 console.log('errors',errs.slice(0,5));process.exit(0);},1500);
