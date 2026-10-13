// V1.1.8 phase 3: Today, Ask dad (by supplier), call log + next follow-up, bill-in-group flags, calendar,
// lead time & MOQ module, bills next step, PO progress strip, simpler All POs panel
const fs=require('fs');const {JSDOM,VirtualConsole}=require('jsdom');
const html=fs.readFileSync('VT_Purchase_Intelligence_V1_1.html','utf8').replace(/<script[^>]*src=[^>]*><\/script>/g,'');
const vc=new VirtualConsole();const errs=[];vc.on('jsdomError',e=>errs.push(String(e.message||e)));
const dom=new JSDOM(html,{runScripts:'dangerously',virtualConsole:vc,url:'https://x.test/'});
const w=dom.window;setTimeout(async()=>{const ev=c=>w.eval(c);
 ev(`liveSync=async()=>{};document.getElementById('btn-ops').click();VT_MODE='followup';acApply();
  window.__copied='';navigator.clipboard={writeText:t=>{window.__copied=t;return Promise.resolve();}};
  window.__posts=[];VT_LIVE.url='https://x.test/exec';VT_LIVE.token='t';vtApiPost=async b=>{__posts.push(b);return {ok:true};};
  const T=t8(),D=n=>d8add(T,n);
  PRODUCTS=new Map([['A',{name:'Alpha'}],['B',{name:'Beta'}],['C',{name:'Gamma'}]]);
  PODOCS=[{poId:'PO-1',realNo:'PO-1',lane:'g',status:'sent',createdAt:D(-4),sentAt:D(-3),supplier:'Zeta Ltd',lines:[{code:'A',name:'Alpha',qty:10,price:100},{code:'B',name:'Beta',qty:10,price:10}],lots:[]},
    {poId:'PO-2',realNo:'PO-2',lane:'g',status:'sent',createdAt:D(-9),sentAt:D(-8),promised:D(-2),supplier:'Acme',lines:[{code:'C',name:'Gamma',qty:5,price:50}],lots:[]},
    {poId:'PO-3',realNo:'PO-3',lane:'n',status:'made',createdAt:D(0),supplier:"Bob's & Co",lines:[{code:'A',name:'Alpha',qty:2,price:100}],lots:[]},
    {poId:'PO-4',realNo:'PO-4',lane:'g',status:'sent',createdAt:D(-5),sentAt:D(-5),promised:D(1),supplier:'Acme',lines:[{code:'A',name:'Alpha',qty:3,price:100}],lots:[]},
    {poId:'PO-5',realNo:'PO-5',lane:'g',status:'sent',createdAt:D(-30),sentAt:D(-30),supplier:'Zeta Ltd',lines:[{code:'C',name:'Gamma',qty:2,price:50}],lots:[]},
    {poId:'PO-6',realNo:'PO-6',lane:'g',status:'sent',createdAt:D(-2),sentAt:D(-2),snoozeUntil:D(3),supplier:'Acme',lines:[{code:'B',name:'Beta',qty:4,price:10}],lots:[]}];
  PODOCS.forEach(lotMirror);
  V11={loaded:true,shipments:[{shipmentId:'S1',shipmentNo:'SH-1',supplier:'Zeta Ltd',status:'Arrived',arrivedAt:D(-1),shipDate:D(-3),lr:'LR9'},
     {shipmentId:'S2',shipmentNo:'SH-2',supplier:'Zeta Ltd',status:'In Transit',shipDate:D(-2)},
     {shipmentId:'S3',shipmentNo:'SH-3',supplier:'Zeta Ltd',status:'Arrived',arrivedAt:D(-20),shipDate:D(-25),lr:'LR1'}],
   allocs:[{shipmentId:'S1',type:'PO',poNumber:'PO-1',canon:'A',code:'A',qty:4},{shipmentId:'S2',type:'PO',poNumber:'PO-1',canon:'B',code:'B',qty:6},{shipmentId:'S3',type:'PO',poNumber:'PO-5',canon:'C',code:'C',qty:2}],
   bills:[{billId:'B3',billNo:'BL-3',supplier:'Zeta Ltd',readyAt:D(-19),miG:'MI1',vasyG:'V1',vasyAt:D(-18)}],billLines:[{billId:'B3',shipmentId:'S3',canon:'C',qtyG:2,qtyN:0}]};
  v11InjectLots();navBadgeDirty();`);
 // 1 ask list
 const asks=()=>ev(`askBuild().filter(x=>x.n).map(x=>x.sup+'['+x.high+'/'+x.n+']: '+x.pos.map(r=>r.p.poId+'('+r.asks.map(a=>a.kind).join('+')+')').concat(x.ships.map(r=>r.s.shipmentNo+'('+r.asks.map(a=>a.kind).join('+')+')')).join(' ')).join(' || ')`);
 console.log('ASK LIST:',asks());
 console.log('PO-6 waiting:',ev(`askBuild().find(x=>x.sup==='Acme').waiting.map(w=>w.p.poId+' '+w.next).join()`));
 // 2 Today
 ev(`navGo('today','today')`);
 console.log('TODAY sections:',ev(`todaySecs().filter(s=>s.rows.length).map(s=>s.k+'='+s.rows.length).join(' ')`));
 console.log('menu:',ev(`[...document.querySelectorAll('#navgroups button')].map(b=>b.textContent+(b.classList.contains('active')?'*':'')).join(' | ')`),'| sub:',ev(`[...document.querySelectorAll('#subnav button')].map(b=>b.textContent).join(' | ')`));
 console.log('today cards:',ev(`[...document.querySelectorAll('#pos-list [id^=today-]')].map(e=>e.id.replace('today-','')).join()`),'| title:',ev(`document.querySelector('#scr-pos h2.sect').textContent.slice(0,40)`));
 // 3 Ask dad screen + log answer (promised)
 ev(`navGo('today','askdad')`);
 console.log('ask cards:',ev(`[...document.querySelectorAll('#pos-list [data-s]')].map(e=>e.dataset.s).join(' | ')`),'| log buttons:',ev(`document.querySelectorAll('#pos-list button[onclick^="fuLogOpen"]').length`));
 ev(`fuLogOpen(['PO-1'],'promised')`);
 console.log('modal open:',ev(`document.getElementById('fulog-modal').classList.contains('on')`),'| date box:',ev(`!!document.getElementById('fulog-date')`));
 ev(`fuLogDate(d8add(t8(),5));document.getElementById('fulog-reason').value='LR in evening';fuLogSave()`);
 console.log('PO-1 promised:',ev(`podocFind('PO-1').promised===d8add(t8(),5)`),'| next f/up = promised−1:',ev(`podocFind('PO-1').snoozeUntil===d8add(t8(),4)`),'| call note:',ev(`JSON.stringify(fuLastCall(podocFind('PO-1'))).slice(0,90)`));
 console.log('after answer:',asks());
 // 4 one answer for all Acme POs (no answer → tomorrow)
 ev(`fuLogOpen(['PO-2','PO-4'],'noanswer');fuLogSave()`);
 console.log('Acme next:',ev(`['PO-2','PO-4'].map(i=>podocFind(i).snoozeUntil===d8add(t8(),1)).join()`),'| delayed needs reason:',ev(`window.__al=[];alert=m=>__al.push(m);fuLogOpen(['PO-2'],'delayed');fuLogSave();__al[0]`));
 ev(`mClose('fulog-modal')`);
 // 5 bill in group flags on SH-2
 ev(`shfBill('S2','personal')`);console.log('SH-2 personal →',ev(`askBuild().find(x=>x.sup==='Zeta Ltd').ships.map(r=>r.s.shipmentNo+':'+r.asks.map(a=>a.kind)).join(' ')`));
 ev(`shfBill('S2','group');shfLater('S2',1)`);console.log('SH-2 in group + ask tomorrow →',ev(`(askBuild().find(x=>x.sup==='Zeta Ltd').ships.find(r=>r.s.shipmentId==='S2')||{asks:[]}).asks.map(a=>a.kind).join()||'(nothing)'`),'| flag kept on PO-1:',ev(`JSON.stringify(podocFind('PO-1').notes.find(n=>n.kind==='ship'))`).slice(0,80));
 // 6 copy text
 ev(`askCopyAll()`);console.log('COPY ALL:\n'+ev(`__copied`));
 ev(`askCopyAnswers()`);console.log('ANSWERS:\n'+ev(`__copied`));
 // 7 calendar
 ev(`navGo('today','fucal')`);console.log('calendar rows:',ev(`[...document.querySelectorAll('#pos-list .card > div')].filter(d=>d.textContent.match(/📞|📝|🤝|🚚|🚛/)).map(d=>d.firstElementChild.textContent+': '+d.lastElementChild.textContent.replace(/\\s+/g,' ').trim()).join(' || ')`));
 // 8 PO window: strip + notes
 ev(`poDetailOpen('PO-1')`);console.log('strip:',ev(`[...document.querySelectorAll('#pod-head span[style*="border-top:4px"] b')].map(b=>b.textContent).join(' | ')`));
 console.log('notes log rows:',ev(`(document.getElementById('pod-body').textContent.match(/Promised date given|bill is in the group/g)||[]).join(', ')`),'| next f/up box:',ev(`!!document.querySelector('#pod-body input[onchange^="fuSetNext"]')`));
 ev(`mClose('po-detail-modal')`);
 // 9 bills next step
 ev(`V11.bills.push({billId:'B1',billNo:'BL-1',supplier:'Zeta Ltd',readyAt:t8()});V11.billLines.push({billId:'B1',shipmentId:'S1',canon:'A',qtyG:4,qtyN:0});navGo('bills');qv11Set('bills','all')`);
 console.log('bill next steps:',ev(`[...document.querySelectorAll('#ships-list button[onclick^="v11BillOpen"]')].map(b=>b.textContent).join(' | ')`),'| today readymi:',ev(`(todaySecs().find(s=>s.k==='readymi')||{rows:[]}).rows.length`));
 // 10 All POs panel
 ev(`navGo('pos','allpos')`);
 console.log('panel: sort box:',ev(`document.querySelector('#pos-list select[onchange^="fundSortSet"] option:checked').textContent`),'| details:',ev(`[...document.querySelectorAll('#pos-list details.fund-more summary b')].map(b=>b.textContent).join(' / ')`),'| supplier & stage up front:',ev(`[...document.querySelectorAll('#pos-list .card .filters')][0].textContent.replace(/\\s+/g,' ').slice(0,60)`));
 ev(`fundSortSet('sup')`);console.log('sort supplier →',ev(`FUND_ORDER.join('>')+' '+FUND_DIR`),'| chase qv:',ev(`fundFilterNoQV(fundBuild(),'chase').map(r=>r.poId).join()`));
 ev(`fundHasTog('transit')`);console.log('clear button shows:',ev(`!!document.querySelector('#pos-list button[onclick="fundClearAll()"]')`));ev(`fundClearAll()`);console.log('cleared:',ev(`FUND_HAS.size`));
 console.log('row info:',ev(`document.querySelector('#pos-list').textContent.match(/📞 next [^\\n]{0,8}/)?.[0]||'-'`));
 // 11 lead time & MOQ
 ev(`navGo('analyse','supterms')`);
 console.log('LT rows:',ev(`stBuild().map(x=>x.sup+'|'+x.canon+' disp'+JSON.stringify(x.disp)+' arr'+JSON.stringify(x.arr)+' q'+JSON.stringify(x.qtys)).join(' ; ')`));
 ev(`const i=document.querySelector('#pos-list input[data-c="A"][onchange^="stSetEl(this,\\'lt\\')"][data-s="Zeta Ltd"]');i.value='12';i.onchange();
   const j=document.querySelector('#pos-list input[data-c="A"][onchange^="stSetEl(this,\\'moq\\')"][data-s="Zeta Ltd"]');j.value='50';j.onchange();`);
 await new Promise(r=>setTimeout(r,1800));
 console.log('saved:',ev(`JSON.stringify(stGet('Zeta Ltd','A'))`).slice(0,60),'| posted:',ev(`JSON.stringify(__posts.filter(p=>String(p.poNumber).startsWith('~ST|')).slice(-1)[0])`));
 ev(`stSet('sup','Zeta Ltd')`);const d=ev(`document.querySelector('#pos-list input[data-c="*"]')`);
 ev(`const k=document.querySelector('#pos-list input[data-c="*"]');k.value='9';k.onchange();confirm=()=>true;stFillBlank()`);
 console.log('fill blank:',ev(`['A','B','C'].map(c=>c+'='+stGet('Zeta Ltd',c).lt).join(' ')`));
 // reload from the sheet rows (other PC)
 ev(`outboxDone('st','Zeta Ltd');ST=new Map();stFromMeta([{poNumber:'~ST|Zeta Ltd|1',supplier:'Zeta Ltd',notes:[['A',12,50,'2026-10-14','x'],['B',9,'','','']]},{poNumber:'PO-1',notes:[]}])`);
 console.log('loaded from PO Meta:',ev(`JSON.stringify([...ST.get('Zeta Ltd').entries()])`),'| PO meta still applied normally:',ev(`!!podocFind('PO-1')`));
 // big supplier → chunks
 ev(`__posts=[];const m=new Map();for(let i=0;i<2500;i++)m.set('CODE'+i,{lt:7,moq:100,at:'2026-10-14',by:'someone'});ST.set('Big',m);ST_CH.set('Big',4)`);
 await ev(`stPush('Big')`);console.log('chunks:',ev(`__posts.map(p=>p.poNumber+':'+p.notes.length+':'+JSON.stringify(p.notes).length).join(' ')`));
 // 12 Operations: no ask list, supplier masked
 ev(`VT_MODE='ops';acApply();navGo('today','today')`);
 console.log('OPS sub:',ev(`[...document.querySelectorAll('#subnav button')].map(b=>b.textContent).join(' | ')`),'| supplier names on Today:',ev(`/Zeta|Acme|Bob/.test(document.getElementById('pos-list').textContent)`),'| bill sections:',ev(`todaySecs().some(s=>s.k==='readymi')`));
 console.log('OPS ask dad direct:',ev(`posAskDad().slice(0,80)`));
 console.log('errors',errs.slice(0,5));process.exit(0);},1500);
