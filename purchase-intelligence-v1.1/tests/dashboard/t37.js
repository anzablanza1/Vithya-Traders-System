const fs=require('fs');const {JSDOM,VirtualConsole}=require('jsdom');
const html=fs.readFileSync('VT_Purchase_Intelligence_V1_1.html','utf8').replace(/<script[^>]*src=[^>]*><\/script>/g,'');
const vc=new VirtualConsole();const errs=[];vc.on('jsdomError',e=>errs.push(String(e.message||e)));
const dom=new JSDOM(html,{runScripts:'dangerously',virtualConsole:vc,url:'https://x.test/'});
const w=dom.window;setTimeout(()=>{const ev=c=>w.eval(c);
 ev(`VT_MODE='mgmt';ITEMS=new Map();PRODUCTS=new Map([['NEWP',{name:'New product (no MRP in Vasy)'}],['OLDP',{name:'Old product',gstMrp:70,gstSp:60}]]);
  PODOCS=[{poId:'PO-1',realNo:'PO-1',lane:'g',status:'sent',supplier:'Acme',lines:[{code:'NEWP',name:'New',qty:10,price:5},{code:'OLDP',name:'Old',qty:10,price:5}],lots:[]}];PODOCS.forEach(lotMirror);
  V11={loaded:true,shipments:[{shipmentId:'S1',shipmentNo:'SH-1',supplier:'Acme',status:'Arrived',arrivedAt:'2026-10-01'},{shipmentId:'S9',shipmentNo:'SH-9',supplier:'Acme',status:'Arrived',arrivedAt:'2026-09-01'}],
   allocs:[{shipmentId:'S1',type:'PO',poNumber:'PO-1',canon:'NEWP',code:'NEWP',qty:10},{shipmentId:'S1',type:'PO',poNumber:'PO-1',canon:'OLDP',code:'OLDP',qty:4}],bills:[],billLines:[]};
  v11InjectLots();v11BillNew('S1');`);
 const k=ev(`B11.lines[0].k`),k2=ev(`B11.lines[1].k`);
 console.log('total qty cells:',ev(`document.getElementById('b11-tq-${k}').textContent+' / '+document.getElementById('b11-tq-${k2}').textContent`),'| header:',ev(`[...document.querySelectorAll('#bill11-modal th')].some(t=>t.textContent==='Total qty')`));
 console.log('red MRP boxes:',ev(`document.querySelectorAll('#bill11-modal .b11-need').length`),'| warning:',ev(`/line\\(s\\) have no MRP/.test(document.getElementById('bill11-modal').textContent)`));
 ev(`v11BillSet('${k}','qtyG',6)`);console.log('after typing w=6 total:',ev(`document.getElementById('b11-tq-${k}').textContent`));
 ev(`v11BillSet('${k}','mrpG',99)`);console.log('typed MRP clears red:',!ev(`document.getElementById('b11-mrpG-${k}').classList.contains('b11-need')`));
 // a previous bill had MRP typed for NEWP → new bill picks it up
 ev(`V11.billLines=[{billId:'B0',lineId:'x',shipmentId:'S9',canon:'NEWP',qtyG:1,mrpG:120,spG:100,updatedAt:'2026-09-02'}];v11BillNew('S1')`);
 console.log('fallback from earlier bill:',ev(`B11.lines[0].mrpG+' / '+B11.lines[0].spG`),'| old product (Vasy):',ev(`B11.lines[1].mrpG+' / '+B11.lines[1].spG`));
 console.log('errors',errs.slice(0,3));process.exit(0);},1500);
