// V1.1.8b: Ask by supplier (rename, tick + bulk actions, expand/collapse all), one density switch, Overview in POs / Shipments / Bills
const fs=require('fs');const {JSDOM,VirtualConsole}=require('jsdom');
const html=fs.readFileSync('VT_Purchase_Intelligence_V1_1.html','utf8').replace(/<script[^>]*src=[^>]*><\/script>/g,'');
const vc=new VirtualConsole();const errs=[];vc.on('jsdomError',e=>errs.push(String(e.message||e)));
const dom=new JSDOM(html,{runScripts:'dangerously',virtualConsole:vc,url:'https://x.test/'});
const w=dom.window;setTimeout(async()=>{const ev=c=>w.eval(c);
 ev(`liveSync=async()=>{};document.getElementById('btn-ops').click();VT_MODE='followup';acApply();
  window.__copied='';navigator.clipboard={writeText:t=>{window.__copied=t;return Promise.resolve();}};
  const T=t8(),D=n=>d8add(T,n);
  PRODUCTS=new Map([['A',{name:'Alpha'}],['B',{name:'Beta'}],['C',{name:'Gamma'}]]);
  PODOCS=[{poId:'PO-1',realNo:'PO-1',lane:'g',status:'sent',createdAt:D(-4),sentAt:D(-3),supplier:'Zeta Ltd',lines:[{code:'A',name:'Alpha',qty:10,price:100},{code:'B',name:'Beta',qty:10,price:10}],lots:[]},
    {poId:'PO-2',realNo:'PO-2',lane:'g',status:'sent',createdAt:D(-9),sentAt:D(-8),promised:D(-2),supplier:'Acme',lines:[{code:'C',name:'Gamma',qty:5,price:50}],lots:[]},
    {poId:'PO-4',realNo:'PO-4',lane:'g',status:'sent',createdAt:D(-5),sentAt:D(-5),supplier:'Acme',lines:[{code:'A',name:'Alpha',qty:3,price:100}],lots:[]}];
  PODOCS.forEach(lotMirror);
  V11={loaded:true,shipments:[{shipmentId:'S1',shipmentNo:'SH-1',supplier:'Zeta Ltd',status:'Arrived',arrivedAt:D(-1),shipDate:D(-3),lr:'LR9'},
     {shipmentId:'S2',shipmentNo:'SH-2',supplier:'Zeta Ltd',status:'In Transit',shipDate:D(-2),expected:D(-1)},
     {shipmentId:'S3',shipmentNo:'SH-3',supplier:'Zeta Ltd',status:'Arrived',arrivedAt:D(-20),shipDate:D(-25),lr:'LR1'}],
   allocs:[{shipmentId:'S1',type:'PO',poNumber:'PO-1',canon:'A',code:'A',qty:4},{shipmentId:'S2',type:'PO',poNumber:'PO-1',canon:'B',code:'B',qty:6},{shipmentId:'S3',type:'PO',poNumber:'PO-2',canon:'C',code:'C',qty:2}],
   bills:[{billId:'B3',billNo:'BL-3',supplier:'Zeta Ltd',readyAt:D(-19),miG:'MI1',vasyG:'V1',vasyAt:D(-18),totalsJson:'{"wTotal":200,"nTotal":0}'},{billId:'B1',billNo:'BL-1',supplier:'Zeta Ltd',readyAt:D(-1),totalsJson:'{"wTotal":400,"nTotal":50}'}],
   billLines:[{billId:'B3',shipmentId:'S3',canon:'C',qtyG:2,qtyN:0},{billId:'B1',shipmentId:'S1',canon:'A',qtyG:4,qtyN:0}]};
  v11InjectLots();navGo('today','askdad');`);
 console.log('sub:',ev(`[...document.querySelectorAll('#subnav button')].map(b=>b.textContent).join(' | ')`),'| "dad" on screen:',ev(`/\\bdad\\b/i.test(document.getElementById('pos-list').textContent+document.getElementById('subnav').textContent)`));
 console.log('ticks:',ev(`document.querySelectorAll('#pos-list input[data-k]').length`),'| supplier ticks:',ev(`document.querySelectorAll('#pos-list input[data-supsel]').length`),'| bar hidden:',ev(`document.getElementById('ask-bar').style.display`));
 // tick the whole Acme card → bar shows POs
 ev(`const c=document.querySelector('#pos-list [data-s="Acme"] input[data-supsel]');c.checked=true;c.onchange()`);
 console.log('Acme ticked:',ev(`[...ASK_UI.sel].join()`),'| bar:',ev(`document.getElementById('ask-bar').textContent.replace(/\\s+/g,' ').trim().slice(0,90)`));
 ev(`askBulkLog('noanswer');fuLogSave()`);
 console.log('bulk no answer → next f/up tomorrow:',ev(`['PO-2','PO-4'].map(i=>podocFind(i).snoozeUntil===d8add(t8(),1)&&fuLastCall(podocFind(i)).outcome==='noanswer').join()`),'| ticks cleared:',ev(`ASK_UI.sel.size`));
 // tick both Zeta shipments → bill in group
 ev(`posRender();document.querySelectorAll('#pos-list input[data-k^="sh:"]').forEach(cb=>{cb.checked=true;cb.onchange();});`);
 console.log('bar for shipments:',ev(`document.getElementById('ask-bar').textContent.replace(/\\s+/g,' ').trim().slice(0,70)`));
 ev(`askCopySel()`);console.log('copy ticked:',JSON.stringify(ev(`__copied`)).slice(0,120));
 ev(`askBulkShip('group')`);console.log('after bulk "in group":',ev(`askBuild().find(x=>x.sup==='Zeta Ltd').ships.map(r=>r.s.shipmentNo+':'+r.asks.map(a=>a.kind)).join(' ')`));
 // tick PO-1 + next follow-up +3
 ev(`fuSetNext('PO-1','');posRender();const cb=document.querySelector('#pos-list input[data-k="po:PO-1"]');cb.checked=true;cb.onchange();askBulkNext(3)`);
 console.log('bulk +3:',ev(`podocFind('PO-1').snoozeUntil===d8add(t8(),3)`));
 // expand / collapse all
 ev(`ASK_UI.all=true;askFoldAll(true)`);console.log('collapsed cards with blocks:',ev(`document.querySelectorAll('#pos-list .ask-blk').length`),'| cards:',ev(`document.querySelectorAll('#pos-list .ask-card').length`));
 ev(`askFoldAll(false)`);console.log('expanded blocks:',ev(`document.querySelectorAll('#pos-list .ask-blk').length`));
 // density: one switch
 ev(`setDensity('condensed')`);console.log('condensed → POS_COMPACT:',ev(`POS_COMPACT`),'| html attr:',ev(`document.documentElement.getAttribute('data-density')`),'| module density controls:',ev(`[...document.querySelectorAll('#pos-controls label')].filter(l=>/density/i.test(l.textContent)).length`));
 ev(`navGo('track','product')`);console.log('By product controls have Density?:',ev(`/Density/i.test(document.getElementById('pos-controls').textContent)`),'| compact class:',ev(`document.getElementById('pos-list').classList.contains('vt-compact')`));
 ev(`setDensity('detailed')`);console.log('detailed → compact class:',ev(`document.getElementById('pos-list').classList.contains('vt-compact')`));
 // overviews
 ev(`navGo('pos')`);console.log('POs sub:',ev(`[...document.querySelectorAll('#subnav button')].map(b=>b.textContent+(b.classList.contains('active')?'*':'')).join(' | ')`));
 ev(`navGo('pos','poov')`);console.log('PO overview tiles:',ev(`document.querySelectorAll('#pos-list .ovc').length`));
 ev(`navGo('ships')`);console.log('Ships sub:',ev(`[...document.querySelectorAll('#subnav button')].map(b=>b.textContent+(b.classList.contains('active')?'*':'')).join(' | ')`));
 ev(`navGo('ships','shipov')`);console.log('Ship overview:',ev(`[...document.querySelectorAll('#pos-list .ovc')].map(t=>t.querySelector('.ovl').textContent+'='+t.querySelector('.ovn').textContent).join(' | ')`),'| title:',ev(`document.querySelector('#scr-pos h2.sect').textContent.slice(0,30)`));
 ev(`ovShipFlag('nolr')`);console.log('no-LR tile → Shipments with filter:',ev(`S11_VIEW+' '+JSON.stringify(F11.ships.flags)`));ev(`F11.ships.flags=[];f11Save()`);
 ev(`navGo('bills','billov')`);console.log('Bill overview:',ev(`[...document.querySelectorAll('#pos-list .ovc')].map(t=>t.querySelector('.ovl').textContent+'='+t.querySelector('.ovn').textContent).join(' | ')`));
 ev(`navGo('bills')`);console.log('Bills default item:',ev(`[...document.querySelectorAll('#subnav button')].map(b=>b.textContent+(b.classList.contains('active')?'*':'')).join(' | ')`));
 ev(`navGo('track')`);console.log('Track sub:',ev(`[...document.querySelectorAll('#subnav button')].map(b=>b.textContent).join(' | ')`));
 ev(`VT_MODE='ops';acApply();navGo('ships','shipov')`);console.log('OPS ship overview supplier table:',ev(`/By supplier/.test(document.getElementById('pos-list').textContent)`),'| supplier names:',ev(`/Zeta/.test(document.getElementById('pos-list').textContent)`),'| groups:',ev(`[...document.querySelectorAll('#navgroups button')].map(b=>b.textContent).join(' | ')`));
 console.log('errors',errs.slice(0,5));process.exit(0);},1500);
