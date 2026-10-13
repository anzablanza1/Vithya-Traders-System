const fs=require('fs');const {JSDOM,VirtualConsole}=require('jsdom');
const html=fs.readFileSync('VT_Purchase_Intelligence_V1_1.html','utf8').replace(/<script[^>]*src=[^>]*><\/script>/g,'');
const vc=new VirtualConsole();const errs=[];vc.on('jsdomError',e=>errs.push(String(e.message||e)));
const dom=new JSDOM(html,{runScripts:'dangerously',virtualConsole:vc,url:'https://x.test/'});
const w=dom.window;setTimeout(()=>{const ev=c=>w.eval(c);
 ev(`VT_MODE='mgmt';PRODUCTS=new Map([['A',{name:'Alpha'}],['B',{name:'Beta'}],['C',{name:'Gamma'}]]);
  PODOCS=[{poId:'PO-1',realNo:'PO-1',lane:'g',status:'sent',sentAt:'2026-09-01',supplier:'Zeta Ltd',lines:[{code:'A',name:'Alpha',qty:10,price:100},{code:'B',name:'Beta',qty:10,price:10}],lots:[]},
    {poId:'PO-2',realNo:'PO-2',lane:'g',status:'sent',sentAt:'2026-09-02',supplier:'Acme',lines:[{code:'C',name:'Gamma',qty:5,price:50}],lots:[]},
    {poId:'PO-3',realNo:'PO-3',lane:'n',status:'made',supplier:"Bob's & Co",lines:[{code:'A',name:'Alpha',qty:2,price:100}],lots:[]}];PODOCS.forEach(lotMirror);
  V11={loaded:true,shipments:[{shipmentId:'S1',shipmentNo:'SH-1',supplier:'Zeta Ltd',status:'Arrived',arrivedAt:'2026-09-05',shipDate:'2026-09-03'},{shipmentId:'S2',shipmentNo:'SH-2',supplier:'Zeta Ltd',status:'In Transit',shipDate:'2026-09-06'}],
   allocs:[{shipmentId:'S1',type:'PO',poNumber:'PO-1',canon:'A',code:'A',qty:4},{shipmentId:'S2',type:'PO',poNumber:'PO-1',canon:'B',code:'B',qty:6}],bills:[],billLines:[]};
  v11InjectLots();switchScreen('pos');posSetView('fund');`);
 const pos=()=>ev(`[...document.querySelectorAll('#fund-body a.linky')].map(a=>a.textContent).join(',')`);
 console.log('stages:',ev(`fundBuild().map(r=>r.no+'='+r.status).join(' ')`),'| shown:',pos());
 ev(`fundHasTog('transit')`);console.log('has in transit:',pos());
 ev(`fundHasTog('transit');fundHasTog('received')`);console.log('has received:',pos());
 ev(`fundHasTog('received');fundHasTog('notsent')`);console.log('not sent:',pos());
 ev(`fundHasTog('notsent');fundHasTog('transit');fundLinesOnly(true)`);console.log('transit only-lines total:',ev(`fundFilter(fundBuild()).map(r=>r.no+' lines '+r.lines.length+' transit₹ '+r.T.vTransit+' pending₹ '+r.T.vPending).join(' | ')`));
 ev(`FUND_HAS.clear();fundLinesOnly(false);fundSetOrder(0,'supplier');fundSetOrder(1,'');fundSetOrder(2,'')`);console.log('order supplier ▲:',pos());
 ev(`FUND_DIR=-1;fundReorder()`);console.log('order supplier ▼:',pos());
 ev(`FUND_DIR=1;fundSetOrder(0,'pendingv');`);console.log('order pending₹ ▲:',pos());
 console.log('order controls on home:',ev(`document.querySelectorAll('#scr-pos select[onchange^="fundSetOrder"]').length`));
 // supplier multi-select with apostrophe
 ev(`FUND_ORDER=['supplier','status','date'];posRender();const cb=[...document.querySelectorAll('.fund-ms[data-w="sup"] input[data-v]')].find(x=>x.getAttribute('data-v')==="Bob's & Co");cb.click();`);
 console.log('supplier Bob\'s & Co →',pos(),'| summary:',ev(`document.querySelector('.fund-ms[data-w="sup"] .fund-ms-sum').firstChild.nodeValue`),'| label:',ev(`document.getElementById('fund-ms-n-sup').textContent`));
 ev(`fundMAll('sup')`);console.log('all suppliers ticked:',ev(`[...document.querySelectorAll('.fund-ms[data-w="sup"] input[data-v]')].every(x=>x.checked)`),pos());
 ev(`fundClear('sup')`);console.log('cleared:',ev(`document.querySelector('.fund-ms[data-w="sup"] .fund-ms-sum').firstChild.nodeValue`),pos());
 ev(`fundPreview()`);console.log('preview order controls:',ev(`document.querySelectorAll('#fp-order select').length`));
 console.log('errors',errs.slice(0,3));process.exit(0);},1500);
