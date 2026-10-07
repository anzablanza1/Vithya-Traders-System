const fs=require('fs');const {JSDOM,VirtualConsole}=require('jsdom');
const html=fs.readFileSync('VT_Purchase_Intelligence_V1_1.html','utf8').replace(/<script[^>]*src=[^>]*><\/script>/g,'');
const vc=new VirtualConsole();const errs=[];vc.on('jsdomError',e=>errs.push(String(e.message||e)));
const dom=new JSDOM(html,{runScripts:'dangerously',virtualConsole:vc,url:'https://x.test/',beforeParse(w){w.alert=m=>{w.__a=(w.__a||[]).concat(String(m))};w.confirm=()=>true;}});
const w=dom.window;setTimeout(async()=>{const ev=c=>w.eval(c);
 try{
 ev(`VT_MODE='mgmt';applyLiveData({products:[{code:'111',name:'Bearing 6203',gstPrice:10,nonPrice:9,gstMrp:70,nonMrp:59,gstSp:58.1,nonSp:49,unit:'kg',gstPct:12,source:'Supabase'}],requests:[]});
  ITEMS=new Map([['111',{code:'111',name:'Bearing 6203',g:Object.assign(laneInit(),{n:3,lastLand:11.5,lastRate:11,lastMRP:65,lastSell:60,last:'2026-09-01'}),n:laneInit(),sups:new Map()}]]);
  PODOCS=[{poId:'PO-1',realNo:'PO-1',lane:'g',status:'sent',supplier:'Acme',lines:[{code:'111',name:'Bearing 6203',qty:10}],lots:[]}];PODOCS.forEach(lotMirror);
  V11={loaded:true,shipments:[{shipmentId:'S1',shipmentNo:'SH-1',supplier:'Acme',status:'Arrived'}],allocs:[{shipmentId:'S1',type:'PO',poNumber:'PO-1',canon:'111',code:'111',qty:10}],bills:[],billLines:[]};`);
 console.log('product loaded:',ev(`JSON.stringify(PRODUCTS.get('111'))`));
 ev(`v11BillNew('S1')`);
 console.log('bill line default:',ev(`(l=>'rateG '+l.rateG+' tax '+l.tax+' mrpG '+l.mrpG+' spG '+l.spG)(B11.lines[0])`));
 console.log('labels in bill header:',ev(`document.querySelectorAll('#bill11-modal .gtag').length`));
 // Vasy rows: make a saved bill
 ev(`V11.bills=[{billId:'B1',billNo:'BL-1',supplier:'Acme',status:'Draft'}];V11.billLines=[{billId:'B1',lineId:'L1',shipmentId:'S1',canon:'111',name:'Bearing 6203',qtyG:10,rateG:100,qtyN:0,rateN:0,tax:12,mrpG:'',spG:'',mrpN:'',spN:''}]`);
 console.log('vasy row:',ev(`JSON.stringify(v11VasyRows('B1').gRows[0].slice(0,6))`),'bad:',ev(`JSON.stringify(v11VasyRows('B1').bad)`));
 console.log('GT:',ev(`GT(1)+GT(0)`).replace(/<[^>]+>/g,'|'));
 console.log('errors',errs.length,errs.slice(0,3));
 }catch(e){console.log('ERR',e.message,errs.slice(0,3));}
 process.exit(0);},1500);
