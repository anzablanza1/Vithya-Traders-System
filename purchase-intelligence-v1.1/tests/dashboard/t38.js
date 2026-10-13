const fs=require('fs');const {JSDOM,VirtualConsole}=require('jsdom');
const html=fs.readFileSync('VT_Purchase_Intelligence_V1_1.html','utf8').replace(/<script[^>]*src=[^>]*><\/script>/g,'');
const vc=new VirtualConsole();const errs=[];vc.on('jsdomError',e=>errs.push(String(e.message||e)));
const dom=new JSDOM(html,{runScripts:'dangerously',virtualConsole:vc,url:'https://x.test/'});
const w=dom.window;setTimeout(()=>{const ev=c=>w.eval(c);
 ev(`PRODUCTS=new Map([['A',{name:'Alpha'}],['B',{name:'Beta'}],['C',{name:'Gamma'}]]);const t=new Date();const ago=d=>{const x=new Date(t);x.setDate(x.getDate()-d);return x.toISOString().slice(0,10);};
  PODOCS=[{poId:'PO-1',realNo:'PO-1',lane:'g',status:'sent',sentAt:ago(20),expected:ago(5),supplier:'Zeta Ltd',lines:[{code:'A',name:'Alpha',qty:10,price:100},{code:'B',name:'Beta',qty:10,price:10}],lots:[],notes:[{text:'call Monday',due:ago(-2),done:false}]},
    {poId:'PO-2',realNo:'PO-2',lane:'g',status:'sent',sentAt:ago(3),promised:ago(-10),supplier:'Acme',lines:[{code:'C',name:'Gamma',qty:5,price:50}],lots:[]},
    {poId:'PO-3',realNo:'PO-3',lane:'n',status:'made',supplier:'Bob',lines:[{code:'A',name:'Alpha',qty:2,price:100}],lots:[]},
    {poId:'PO-4',realNo:'PO-4',lane:'g',status:'sent',sentAt:ago(30),supplier:'Acme',lines:[{code:'B',name:'Beta',qty:3,price:10}],lots:[]},
    {poId:'PO-5',realNo:'PO-5',lane:'g',status:'sent',supplier:'Acme',closed:true,lines:[{code:'B',name:'Beta',qty:3,price:10}],lots:[]}];PODOCS.forEach(lotMirror);
  V11={loaded:true,shipments:[{shipmentId:'S1',shipmentNo:'SH-1',supplier:'Zeta Ltd',status:'Arrived',arrivedAt:ago(10),shipDate:ago(12)},{shipmentId:'S2',shipmentNo:'SH-2',supplier:'Zeta Ltd',status:'In Transit',shipDate:ago(4),expected:ago(1)},{shipmentId:'S3',shipmentNo:'SH-3',supplier:'Acme',status:'Arrived',arrivedAt:ago(1),shipDate:ago(2)}],
   allocs:[{shipmentId:'S1',type:'PO',poNumber:'PO-1',canon:'A',code:'A',qty:4},{shipmentId:'S2',type:'PO',poNumber:'PO-1',canon:'B',code:'B',qty:6},{shipmentId:'S3',type:'PO',poNumber:'PO-4',canon:'B',code:'B',qty:3}],
   bills:[{billId:'B1',billNo:'BL-1',supplier:'Zeta Ltd',readyAt:ago(3)},{billId:'B2',billNo:'BL-2',supplier:'Acme',readyAt:ago(1)}],billLines:[{billId:'B1',shipmentId:'S2',canon:'B',qtyG:6},{billId:'B2',shipmentId:'S3',canon:'B',qtyG:3}]};
  v11InjectLots();VT_MODE='followup';acApply();navGo('pos','allpos');`);
 const groups=()=>ev(`[...document.querySelectorAll('#navgroups button')].map(b=>b.textContent+(b.classList.contains('active')?'*':'')).join(' | ')`);
 const sub=()=>ev(`[...document.querySelectorAll('#subnav button')].map(b=>b.textContent+(b.classList.contains('active')?'*':'')).join(' | ')`);
 const pos=()=>ev(`[...document.querySelectorAll('#fund-body a.linky')].map(a=>a.textContent).join(',')`);
 console.log('PURCHASE TEAM menu:',groups());console.log('  sub:',sub());
 console.log('  title:',ev(`document.querySelector('#scr-pos h2.sect').textContent`).slice(0,60));
 console.log('  All POs:',pos(),'| quick views:',ev(`[...document.querySelectorAll('#pos-list .qv button')].map(b=>b.textContent).join(' / ')`));
 for(const k of ['send','chase','waiting','close']){ev(`apoSetQV('${k}')`);console.log('   qv',k,'→',pos());}
 ev(`apoSetQV('')`);console.log('  row actions PO-3:',ev(`[...document.querySelectorAll('#fund-body button')].map(b=>b.textContent).filter(t=>/Send|Ship|Close/.test(t)).join(',')`));
 console.log('  row info has note + overdue:',ev(`/call Monday/.test(document.getElementById('fund-body').textContent)&&/overdue/.test(document.getElementById('fund-body').textContent)`));
 ev(`navGo('analyse','fund')`);console.log('  Analyse sub:',sub(),'| fund POs:',pos(),'| fund order kept:',ev(`FUND_ORDER.join('>')`));
 ev(`navGo('pos','allpos')`);console.log('  back to All POs keeps its own filters/order:',ev(`FUND_ORDER.join('>')+' dir '+FUND_DIR`));
 ev(`navGo('track')`);console.log('  Track sub:',sub(),'| view:',ev('POS_VIEW'));
 ev(`navGo('ships')`);console.log('  Shipments qv:',ev(`[...document.querySelectorAll('#ships-fbar .qv button')].map(b=>b.textContent).join(' / ')`));
 ev(`qv11Set('ships','arrnobill')`);console.log('   arrived no bill:',ev(`[...document.querySelectorAll('#ships-list tbody tr a.linky')].map(a=>a.textContent).filter(t=>/^SH/.test(t)).join(',')`));
 ev(`qv11Set('ships','billnoarr')`);console.log('   billed not arrived:',ev(`[...document.querySelectorAll('#ships-list tbody tr a.linky')].map(a=>a.textContent).filter(t=>/^SH/.test(t)).join(',')`));
 ev(`navGo('bills')`);console.log('  Bills title:',ev(`document.querySelector('#scr-ships h2.sect').textContent`).slice(0,40),'| active:',groups());
 ev(`qv11Set('bills','readywait')`);console.log('   ready, goods not arrived:',ev(`[...document.querySelectorAll('#ships-list tbody tr a.linky')].map(a=>a.textContent).filter(t=>/^BL/.test(t)).join(',')`));
 ev(`qv11Set('bills','readymi')`);console.log('   ready → MI:',ev(`[...document.querySelectorAll('#ships-list tbody tr a.linky')].map(a=>a.textContent).filter(t=>/^BL/.test(t)).join(',')`));
 ev(`VT_MODE='ops';acApply();navGo('pos','allpos')`);
 console.log('OPERATIONS menu:',groups(),'| supplier shown:',/Zeta|Acme/.test(ev(`document.getElementById('pos-list').textContent`)),'| ₹ shown:',/₹/.test(ev(`document.getElementById('pos-list').textContent`)));
 ev(`VT_MODE='mgmt';acApply();navGo('analyse')`);console.log('MANAGEMENT analyse:',sub());
 ev(`switchScreen('requests')`);console.log('switchScreen syncs menu:',groups(),'/',sub());
 ev(`navGo('analyse','history')`);console.log('history shows closed PO-5:',/PO-5/.test(ev(`document.getElementById('pos-list').textContent`)));
 ev(`navGo('track','kanban')`);console.log('board hides closed PO-5:',!/PO-5/.test(ev(`document.getElementById('pos-list').textContent`)));
 ev(`VT_MODE='ops';acApply();navGo('pos','allpos')`);const tx=ev(`document.getElementById('pos-list').textContent`);const i=tx.indexOf('₹');console.log('₹ context:',JSON.stringify(tx.slice(Math.max(0,i-80),i+20)));console.log('errors',errs.slice(0,4));process.exit(0);},1500);
