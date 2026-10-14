// V1.1.9c: connection window from any screen, one save at a time, automatic retry, "not saved" dialog keeps the entries
const fs=require('fs');const {JSDOM,VirtualConsole}=require('jsdom');
const html=fs.readFileSync('VT_Purchase_Intelligence_V1_1.html','utf8').replace(/<script[^>]*src=[^>]*><\/script>/g,'');
const vc=new VirtualConsole();const errs=[];vc.on('jsdomError',e=>errs.push(String(e.message||e)));
const dom=new JSDOM(html,{runScripts:'dangerously',virtualConsole:vc,url:'https://x.test/',beforeParse(w){w.__al=[];w.alert=m=>w.__al.push(String(m));w.confirm=()=>true;
  // fake Apps Script: plan = list of behaviours for the next POSTs ('net' = network failure, 'lock' = sheet busy, 'ok')
  w.__plan=[];w.__calls=[];w.__live=0;w.__max=0;
  w.fetch=async(url,opts)=>{const body=opts&&opts.body?JSON.parse(opts.body):{api:(String(url).match(/api=([^&]+)/)||[])[1]};
    w.__calls.push(body.api);const wr=!/^(history|data|ping|v11data)$/.test(body.api||'');if(wr){w.__live++;w.__max=Math.max(w.__max,w.__live);}await new Promise(r=>setTimeout(r,30));if(wr)w.__live--;
    const step=(opts&&opts.method==='POST')?(w.__plan.shift()||'ok'):'ok';
    if(step==='net')throw new TypeError('Failed to fetch');
    const res=step==='lock'?{ok:false,error:'Lock timeout: another process was holding the lock for too long.'}
      :body.api==='ping'?{ok:true,version:'7.2'}:body.api==='data'?{ok:true,requests:[],tracking:[],poMeta:[],shipments:[],shipAllocs:[],bills:[],billLines:[]}
      :body.api==='shipment'?{ok:true,shipmentId:body.shipment.shipmentId,shipmentNo:'SH-9',v11data:{ok:true,shipments:[{shipmentId:body.shipment.shipmentId,shipmentNo:'SH-9',supplier:'Zeta Ltd',status:'In Transit',shipDate:'2026-10-14'}],shipAllocs:[],bills:[],billLines:[]}}
      :{ok:true};
    return {ok:true,status:200,text:async()=>JSON.stringify(res),json:async()=>res};};}});
const w=dom.window;setTimeout(async()=>{const ev=c=>w.eval(c);const wait=ms=>new Promise(r=>setTimeout(r,ms));
 ev(`liveSync=async()=>{};document.getElementById('btn-ops').click();VT_MODE='followup';acApply();
   PRODUCTS=new Map([['A',{name:'Alpha'}]]);
   PODOCS=[{poId:'PO-1',realNo:'PO-1',lane:'g',status:'sent',createdAt:'2026-10-10',sentAt:'2026-10-10',supplier:'Zeta Ltd',lines:[{code:'A',name:'Alpha',qty:10,price:5}],lots:[]}];PODOCS.forEach(lotMirror);
   V11={loaded:true,shipments:[],allocs:[],bills:[],billLines:[]};VT_LIVE.url='';VT_LIVE.token='';syncPaint();navGo('ships');`);
 console.log('not connected → header button:',ev(`document.getElementById('sync-pill').textContent`),'| visible:',ev(`document.getElementById('sync-pill').style.display`));
 ev(`document.getElementById('sync-pill').click()`);
 console.log('click → connection window open:',ev(`document.getElementById('conn-modal').classList.contains('on')`),'| link box inside it:',ev(`!!document.querySelector('#conn-modal #live-url')`),'| still on:',ev(`NAV_CUR.g`),'| link box on Requests screen:',ev(`!!document.querySelector('#scr-requests #live-url')`));
 ev(`mClose('conn-modal')`);
 // a shipment draft while NOT connected → dialog, entries kept
 ev(`v11ShipNew();S11.supplier='Zeta Ltd';v11AddRow('A','');S11.rows[0].qty=4;v11ShipModal();`);
 ev(`window.__saveP=v11ShipSave()`);await wait(50);
 console.log('save while not connected → dialog:',ev(`document.getElementById('savefail-modal').classList.contains('on')`),'| draft still open:',ev(`document.getElementById('ship11-modal').classList.contains('on')&&S11.rows[0].qty===4`),'| alerts:',ev(`__al.length`));
 ev(`connOpen()`);console.log('fix connection from the dialog → window on top:',ev(`MODAL_STACK.slice(-1)[0]`));
 ev(`document.getElementById('live-url').value='https://x.test/exec';document.getElementById('live-token').value='t';`);
 await ev(`liveTest()`);await wait(400);await ev(`__saveP`);
 console.log('connected → waiting save sent by itself:',ev(`__calls.includes('shipment')`),'| draft window closed after save:',!ev(`document.getElementById('ship11-modal').classList.contains('on')`),'| shipment in list:',ev(`V11.shipments.map(s=>s.shipmentNo).join()`));
 // automatic retry: two network failures, then OK
 ev(`__calls=[];__plan=['net','net','ok'];window.__r1=vtApiPost({api:'meta',poNumber:'PO-1'})`);await wait(6500);
 console.log('network blip ×2 → retried, result ok:',ev(`__calls.filter(c=>c==='meta').length`),'calls');ev(`__r1.then(r=>window.__r1v=r)`);await wait(10);console.log('   value:',ev(`JSON.stringify(__r1v)`));
 ev(`__calls=[];__plan=['lock','ok'];window.__r2=vtApiPost({api:'meta',poNumber:'PO-1'}).then(r=>window.__r2v=r)`);await wait(2500);
 console.log('sheet busy (lock) → retried:',ev(`__calls.length`),'calls ·',ev(`JSON.stringify(__r2v)`));
 ev(`__calls=[];__plan=['net','ok'];window.__r3=vtApiPost({api:'shipmentDelete',shipmentId:'X'}).catch(e=>window.__r3e=e.message)`);await wait(300);
 console.log('delete is not repeated after a network failure:',ev(`__calls.length`),'call ·',ev(`__r3e`));
 // one save at a time
 ev(`__max=0;__calls=[];__plan=[];window.__ps=[1,2,3,4].map(i=>vtApiPost({api:'meta',poNumber:'PO-'+i}));window.__rd=vtApiPost({api:'history',id:'S1'});`);await wait(400);
 console.log('4 saves at once (+1 read) → saves in flight together:',ev(`__max`),'| all done:',ev(`__calls.filter(c=>c==='meta').length`));
 // outbox: two flushes at the same moment send each change once
 ev(`__calls=[];VT_OUTBOX=[];outboxAdd('meta','PO-1');outboxFlush();outboxFlush();`);await wait(400);
 console.log('two flushes at once → sends:',ev(`__calls.filter(c=>c==='meta').length`),'| waiting:',ev(`VT_OUTBOX.length`));
 // sheet keeps failing → "not saved" dialog; Close keeps the entries
 ev(`v11ShipNew();S11.supplier='Zeta Ltd';v11AddRow('A','');S11.rows[0].qty=2;v11ShipModal();__plan=['net','net','net'];window.__p4=v11ShipSave()`);await wait(6500);
 console.log('3 failures → dialog:',ev(`document.getElementById('savefail-modal').classList.contains('on')`),'| text:',ev(`document.getElementById('savefail-body').textContent.replace(/\\s+/g,' ').slice(0,90)`));
 ev(`vtSaveFailDone('cancel')`);await ev(`__p4`);console.log('Close → entries still on screen:',ev(`document.getElementById('ship11-modal').classList.contains('on')&&S11.rows[0].qty===2`));
 ev(`__plan=['ok'];window.__p5=v11ShipSave()`);await wait(300);await ev(`__p5`);console.log('save again → saved:',!ev(`document.getElementById('ship11-modal').classList.contains('on')`));
 ev(`syncPaint()`);console.log('header now:',ev(`document.getElementById('sync-pill').textContent`));
 ev(`acOpenSettings()`);console.log('settings has connection button:',ev(`[...document.querySelectorAll('#settings-modal button')].some(b=>/Open connection/.test(b.textContent))`));
 console.log('errors',errs.slice(0,5));process.exit(0);},1500);
