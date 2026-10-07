// R39 behaviour audit — render each screen / window with sample data and press EVERY button / link.
// A handler "fails" if it throws, or causes a page error. confirm() answers Cancel, so nothing is deleted.
const fs=require('fs');const {JSDOM,VirtualConsole}=require('jsdom');
const html=fs.readFileSync('VT_Purchase_Intelligence_V1_1.html','utf8').replace(/<script[^>]*src=[^>]*><\/script>/g,'');
const vc=new VirtualConsole();let pageErrs=[];vc.on('jsdomError',e=>pageErrs.push(String(e.message||e).split('\n')[0]));
const dom=new JSDOM(html,{runScripts:'dangerously',virtualConsole:vc,url:'https://x.test/',pretendToBeVisual:true,
  beforeParse(w){w.alert=()=>{};w.confirm=()=>false;w.prompt=()=>null;w.open=()=>null;w.scrollTo=()=>{};
    w.addEventListener('unhandledrejection',e=>pageErrs.push('promise: '+String(e.reason&&e.reason.message||e.reason)));}});
const w=dom.window;const ev=c=>w.eval(c);
const SETUP=`document.querySelectorAll('.modal-bg.on').forEach(m=>m.classList.remove('on'));MODAL_STACK=[];VT_LIVE.url='https://x';VT_LIVE.token='t';VT_MODE='mgmt';
  vtApiPost=async b=>({ok:true,v11data:{ok:true,shipments:V11.shipments,shipAllocs:V11.allocs,bills:V11.bills,billLines:V11.billLines}});liveSync=async()=>{};
  XLSX={utils:{book_new:()=>({}),aoa_to_sheet:()=>({}),book_append_sheet:()=>{},json_to_sheet:()=>({}),sheet_to_json:()=>[]},writeFile:()=>{},write:()=>''};
  PRODUCTS=new Map([['111',{name:'Bearing 6203',gstPrice:10,nonPrice:9,gstMrp:70,nonMrp:59,gstSp:58,nonSp:49,unit:'nos',gstPct:18}],['222',{name:'Oil seal 30x58',gstPrice:3,nonPrice:3,gstMrp:9,nonMrp:9}]]);
  PODOCS=[{poId:'PO-1',realNo:'PO-1',lane:'g',status:'sent',supplier:'Acme',sentAt:'2026-09-01',expected:'2026-09-20',lines:[{code:'111',name:'Bearing 6203',qty:10,price:10,mrp:70},{code:'222',name:'Oil seal 30x58',qty:5,price:3}],
    lots:[{lotId:'L1',lotNo:'01',_synced:true,date:'2026-09-02',lines:[{i:0,code:'111',name:'Bearing 6203',qty:4,g:null,n:null,rate:10,ret:0,flags:[]}]}]},
   {poId:'PO-2',realNo:'PO-2',lane:'n',status:'draft',supplier:'Beta',lines:[{code:'222',name:'Oil seal 30x58',qty:8,price:3}],lots:[]}];
  PODOCS.forEach(lotMirror);
  V11={loaded:true,shipments:[{shipmentId:'S1',shipmentNo:'SH-1',supplier:'Acme',status:'In Transit',shipDate:'2026-09-05'},{shipmentId:'S2',shipmentNo:'SH-2',supplier:'Acme',status:'Arrived',arrivedAt:'2026-09-06'}],
    allocs:[{shipmentId:'S1',type:'PO',poNumber:'PO-1',canon:'111',code:'111',name:'Bearing 6203',qty:3},{shipmentId:'S2',type:'PO',poNumber:'PO-1',canon:'222',code:'222',name:'Oil seal',qty:5}],
    bills:[{billId:'B1',billNo:'BL-1',supplier:'Acme',status:'Draft'}],billLines:[{billId:'B1',lineId:'B1-1',shipmentId:'S2',canon:'222',name:'Oil seal',qtyG:5,rateG:3,qtyN:0,rateN:0,tax:18}]};
  v11InjectLots();`;
const CTX=[
 ['Requests screen',`switchScreen('requests')`],['PO builder screen',`switchScreen('po')`],['POs screen',`switchScreen('pos')`],['Shipments screen',`switchScreen('ships')`],
 ['PO detail window',`switchScreen('pos');poDetailOpen('PO-1')`],['PO edit window',`poEditOpen('PO-1')`],
 ['Shipment window (new)',`v11ShipNew()`],['Shipment window (edit)',`v11ShipEdit('S1')`],['Bill window',`v11BillOpen('B1')`],['Material inward window',`v11MiOpen('S2')`],
 ['Settings window',`acOpenSettings()`],
 ['Shipments + filters open',`F11_OPEN=true;switchScreen('ships');v11ShipsView('ships')`],
 ['Bills + filters open',`F11_OPEN=true;switchScreen('ships');v11ShipsView('bills')`],
 ['POs · dash view',`switchScreen('pos');posSetView('dash')`],
 ['POs · brief view',`switchScreen('pos');posSetView('brief')`],
 ['POs · goods view',`switchScreen('pos');posSetView('goods')`],
 ['POs · history view',`switchScreen('pos');posSetView('history')`],
 ['POs · analytics view',`switchScreen('pos');posSetView('analytics')`],
 ['POs · fund view',`switchScreen('pos');posSetView('fund')`],
 ['POs · kanban view',`switchScreen('pos');posSetView('kanban')`],
 ['POs · timeline view',`switchScreen('pos');posSetView('timeline')`],
 ['POs · po view',`switchScreen('pos');posSetView('po')`],
 ['POs · product view',`switchScreen('pos');posSetView('product')`],
 ['POs · bill view',`switchScreen('pos');posSetView('bill')`]];
function visibleClickables(scope){return [...w.document.querySelectorAll('[onclick]')].filter(el=>{
  if(el.closest('.screen')&&!el.closest('.screen.on'))return false;
  const m=el.closest('.modal-bg');if(m&&!m.classList.contains('on'))return false;
  return true;});}
setTimeout(async()=>{
  const out=[];let total=0,fails=0;
  for(const [name,open] of CTX){
    let list=[];
    try{ev(SETUP);ev(open);list=visibleClickables().map(el=>({code:el.getAttribute('onclick'),label:(el.textContent||el.title||'').trim().replace(/\s+/g,' ').slice(0,40)}));}
    catch(e){out.push(`✗ ${name}: could not open — ${e.message}`);fails++;continue;}
    const seen=new Set();let nOk=0;const bad=[];
    for(let k=0;k<list.length;k++){const key=list[k].code;if(seen.has(key))continue;seen.add(key);total++;
      try{ev(SETUP);ev(open);}catch(e){}
      const el=visibleClickables().find(x=>x.getAttribute('onclick')===key);if(!el){continue;}
      pageErrs=[];let err='';
      try{const r=(new w.Function('event',key)).call(el,{target:el,stopPropagation(){},preventDefault(){}});if(r&&r.then)await r.catch(e=>{err='async: '+e.message;});}
      catch(e){err=e.message;}
      await new Promise(r=>setTimeout(r,5));
      if(!err&&pageErrs.length)err=pageErrs[0];
      if(err){fails++;bad.push(`   ✗ [${list[k].label||'(no text)'}] ${key.slice(0,70)} → ${err}`);}else nOk++;
      ev(`document.querySelectorAll('.modal-bg.on').forEach(m=>m.classList.remove('on'));MODAL_STACK=[];`);
    }
    out.push(`${bad.length?'✗':'✓'} ${name}: ${nOk} button(s) work${bad.length?', '+bad.length+' problem(s)':''}`);bad.forEach(b=>out.push(b));
  }
  // delete buttons: which function does each call?
  ev(SETUP);
  const dels=new Map();for(const [name,open] of CTX){try{ev(SETUP);ev(open);}catch(e){continue;}
    visibleClickables().filter(el=>/delete|🗑|remove|✕/i.test(el.textContent+' '+(el.title||''))).forEach(el=>{const f=(el.getAttribute('onclick').match(/([A-Za-z_$][\w$]*)\(/)||[])[1];const k=name+' · '+(el.textContent||el.title).trim().replace(/\s+/g,' ').slice(0,30);dels.set(k,f);});}
  console.log(out.join('\n'));
  console.log(`\nTOTAL: ${total} distinct buttons pressed, ${fails} problem(s).`);
  console.log('\nDelete / remove buttons → function they call:');dels.forEach((f,k)=>console.log('  '+k+' → '+f));
  process.exit(0);},1500);
