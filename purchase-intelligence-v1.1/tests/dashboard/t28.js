const fs=require('fs');const {JSDOM,VirtualConsole}=require('jsdom');
const html=fs.readFileSync('VT_Purchase_Intelligence_V1_1.html','utf8').replace(/<script[^>]*src=[^>]*><\/script>/g,'');
const vc=new VirtualConsole();const errs=[];vc.on('jsdomError',e=>errs.push(String(e.message||e)));
const dom=new JSDOM(html,{runScripts:'dangerously',virtualConsole:vc,url:'https://x.test/',beforeParse(w){w.alert=m=>{w.__a=(w.__a||[]).concat(String(m))};w.confirm=()=>true;}});
const w=dom.window;setTimeout(async()=>{const ev=c=>w.eval(c);
 try{
 ev(`VT_LIVE.url='https://x';VT_LIVE.token='t';window.__posts=[];
  vtApiPost=async b=>{__posts.push(b.api);if(b.api==='shipment')return {ok:true,shipmentNo:'SH-7',warnings:[],v11data:{ok:true,shipments:[{shipmentId:'NEW',shipmentNo:'SH-7',supplier:'Acme',status:'In Transit'}],shipAllocs:[],bills:[],billLines:[]}};
    if(b.api==='v11data')return {ok:true,shipments:[],shipAllocs:[],bills:[],billLines:[]};return {ok:true};};
  liveSync=async()=>{};VT_MODE='mgmt';
  PRODUCTS=new Map([['111',{name:'Bearing 6203',price:10}],['222',{name:'Oil seal 30x58',price:3}]]);
  PODOCS=[{poId:'PO-1',realNo:'PO-1',lane:'g',status:'sent',supplier:'Acme',lines:Array.from({length:19},(_,i)=>({code:'C'+i,name:'Size '+i+' MM SEAL',qty:10+i})),lots:[]}];PODOCS.forEach(lotMirror);
  V11={loaded:true,shipments:[],allocs:[],bills:[],billLines:[]};`);
 ev(`v11ShipNew();v11SetSupplier('Acme');v11PoPickOpen('PO-1')`);
 console.log('pick list rows:',ev(`document.querySelectorAll('#s11-pick-list input[type=checkbox]').length`));
 ev(`v11PoPickTick(2,true);v11PoPickTick(7,true)`);console.log('button label:',ev(`[...document.querySelectorAll('#s11-body button')].find(x=>/^＋ add /.test(x.textContent)).textContent`));
 ev(`S11._poPick.q='size 1';v11PoPickPaint()`);console.log('filtered rows:',ev(`document.querySelectorAll('#s11-pick-list input').length`));
 ev(`v11PoPickAdd()`);console.log('rows after add:',ev(`S11.rows.map(r=>r.canon+':'+r.qty).join(',')`),'| row class:',ev(`document.getElementById('s11-row-'+S11.rows[0].k).className`));
 await ev(`v11ShipSave()`);console.log('posts:',ev(`__posts.join(',')`),'| list has SH-7 without v11data call:',ev(`V11.shipments.length`)===1&&!ev(`__posts.includes('v11data')`));
 // bill split
 ev(`V11={loaded:true,shipments:[{shipmentId:'S1',shipmentNo:'SH-1',supplier:'Acme',status:'In Transit'}],allocs:[{shipmentId:'S1',type:'PO',poNumber:'PO-1',canon:'C1',code:'C1',qty:10}],bills:[],billLines:[]};v11BillNew('S1')`);
 const k=ev(`B11.lines[0].k`);
 ev(`v11BillSet('${k}','qtyG',6)`);console.log('w6 → wo:',ev(`B11.lines[0].qtyN`),'| wo input:',ev(`document.getElementById('b11-qtyN-${k}').value`));
 ev(`v11BillSet('${k}','qtyN',10)`);console.log('wo10 → w:',ev(`B11.lines[0].qtyG`));
 console.log('charge datalist options:',ev(`document.querySelectorAll('#b11-chg-list option').length`));
 console.log('bill band:',ev(`document.querySelector('#bill11-modal .v11-band.bill')!==null`));
 // PO builder unit + search
 ev(`ITEMS=new Map();PO=[{id:'x1',code:'111',lane:'g',qty:2,price:1,mrp:2,supplier:'Acme'}];poSetUom('x1','box')`);console.log('po line uom:',ev(`unitOf(PO[0])`));
 ev(`SIDX=[];document.getElementById('po-q').value='oil seal';poRunSearch()`);console.log('search after empty index:',ev(`/Oil seal/.test(document.getElementById('po-results').textContent)`),ev(`document.getElementById('po-results').textContent.slice(0,1).replace(/\\s+/g,' ')`));
 console.log('errors',errs.length,errs.slice(0,3));
 }catch(e){console.log('ERR',e.stack.split('\n').slice(0,3).join(' | '),errs.slice(0,3));}
 process.exit(0);},1500);
