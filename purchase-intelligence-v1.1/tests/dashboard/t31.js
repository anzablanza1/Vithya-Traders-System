const fs=require('fs');const {JSDOM,VirtualConsole}=require('jsdom');
const html=fs.readFileSync('VT_Purchase_Intelligence_V1_1.html','utf8').replace(/<script[^>]*src=[^>]*><\/script>/g,'');
const vc=new VirtualConsole();const errs=[];vc.on('jsdomError',e=>errs.push(String(e.message||e)));
const dom=new JSDOM(html,{runScripts:'dangerously',virtualConsole:vc,url:'https://x.test/',beforeParse(w){w.alert=m=>{w.__a=(w.__a||[]).concat(String(m))};w.confirm=()=>true;}});
const w=dom.window;setTimeout(async()=>{const ev=c=>w.eval(c);
 try{
 ev(`VT_LIVE.url='https://x';VT_LIVE.token='t';window.__posts=[];
  vtApiPost=async b=>{__posts.push(b.api+(b.lot?':'+b.lot.lotId:'')+(b.from?':'+b.from+'>'+b.to:''));if(b.api==='shipmentRecode')return {ok:true,summary:{},v11data:{ok:true,shipments:V11.shipments,shipAllocs:V11.allocs.map(a=>Object.assign({},a,{canon:'777',code:'777'})),bills:[],billLines:[]}};return {ok:true};};
  liveSync=async()=>{};VT_MODE='mgmt';
  PRODUCTS=new Map([['111',{name:'Wrong bearing'}],['777',{name:'Right bearing'}]]);
  PODOCS=[{poId:'PO-1',realNo:'PO-1',lane:'g',status:'sent',supplier:'Acme',lines:[{code:'111',name:'Wrong bearing',qty:10,price:5}],
    lots:[{lotId:'L1',lotNo:'01',_synced:true,date:'2026-09-01',lines:[{i:0,code:'111',name:'Wrong bearing',qty:4,g:null,n:null,rate:5,ret:0,flags:[]}]}]}];PODOCS.forEach(lotMirror);
  V11={loaded:true,shipments:[{shipmentId:'S1',shipmentNo:'SH-1',supplier:'Acme',status:'In Transit'}],allocs:[{shipmentId:'S1',type:'PO',poNumber:'PO-1',canon:'111',code:'111',qty:3,ret:1}],bills:[],billLines:[]};
  v11InjectLots();`);
 console.log('shipped on line:',ev(`shipForLine(PODOCS[0],0)`),'| SHP lot ret:',ev(`PODOCS[0].lots.find(L=>L._v11).lines[0].ret`));
 ev(`poEditOpen('PO-1')`);
 console.log('correct button:',ev(`[...document.querySelectorAll('#pe-rows button')].map(b=>b.textContent.trim()).join('|')`));
 ev(`poFixOpen(0)`);console.log('panel:',ev(`document.getElementById('pe-fix').textContent.replace(/\\s+/g,' ').slice(0,260)`));
 ev(`PICK_CB['pefix']('777')`);
 await ev(`poFixApply()`);console.log('without CORRECT → posts:',ev(`__posts.join(',')`));
 ev(`document.getElementById('pefix-ok').value='correct'`);await ev(`poFixApply()`);
 await new Promise(r=>setTimeout(r,300));
 console.log('posts:',ev(`__posts.join(',')`));
 console.log('PO line now:',ev(`PODOCS[0].lines[0].code+' '+PODOCS[0].lines[0].name`),'| old lot line:',ev(`PODOCS[0].lots.find(L=>!L._v11).lines[0].code`),'| still shipped:',ev(`shipForLine(PODOCS[0],0)`));
 console.log('correct-product buttons outside PO edit:',ev(`[...document.querySelectorAll('[onclick*=poFixOpen]')].filter(b=>!b.closest('#poedit-modal')).length`));
 console.log('errors',errs.length,errs.slice(0,3),'alerts',w.__a);
 }catch(e){console.log('ERR',e.message,e.stack.split('\n')[1],errs.slice(0,3));}
 process.exit(0);},1500);
