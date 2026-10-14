// [2.8 R93] how much sheet reading/writing one shipment save and one bill save cost (through the dashboard route)
const fs=require('fs');const dir=process.argv[2]||'.';process.chdir(dir);
eval(fs.readFileSync('hbase.js','utf8').replace("const ss={","let READS=0,CELLS=0,WCELLS=0;const _gr=mkSheet;\nconst ss={")+`
// count reads / written cells
Object.values(sheets).forEach(()=>{});
const wrap=sh=>{const g=sh.getRange.bind(sh);sh.getRange=(r,c,nr,nc)=>{const rg=g(r,c,nr,nc);const gv=rg.getValues,sv=rg.setValues;
  rg.getValues=()=>{READS++;const v=gv();const c=v.length*(v[0]?v[0].length:0);CELLS+=c;(global.BY=global.BY||{})[sh.name]=((global.BY||{})[sh.name]||0)+1;if(global.TR)console.log('   read',sh.name,c,new Error().stack.split(String.fromCharCode(10)).slice(2,5).map(x=>x.trim().split(' ')[1]).join(' < '));return v;};rg.setValues=v=>{WCELLS+=v.length*(v[0]?v[0].length:0);return sv(v);};return rg;};return sh;};
const _ins=ss.insertSheet;ss.insertSheet=n=>wrap(_ins(n));Object.values(sheets).forEach(wrap);
const api=(a,b)=>JSON.parse(ctx.handleApi_(a,{},Object.assign({token:'x'},b||{})));
ctx.setupShipmentsV11&&ctx.setupShipmentsV11();ctx.setupBillsV11&&ctx.setupBillsV11();Object.values(sheets).forEach(wrap);
// background: 300 shipments with 4 allocations each, 200 bills
for(let i=0;i<300;i++)T.data.push([new Date(),'PO-X'+i+'|L1','L1','PR-1','C'+i,'n','GST','PO-X'+i,'',100,'PO Sent','','','','x','Sup','','']);
for(let i=0;i<300;i++)api('shipment',{shipment:{shipmentId:'B'+i,supplier:'Sup',shipDate:'2026-10-01',status:'In Transit',allocations:[0,1,2,3].map(k=>({type:'PO',poNumber:'PO-X'+i,code:'C'+i,name:'n',qty:1+k}))},by:'x'});
for(let i=0;i<200;i++)api('bill',{bill:{billId:'BB'+i,supplier:'Sup',billDate:'2026-10-02',lines:[{shipmentId:'B'+i,code:'C'+i,name:'n',qtyG:10,rateG:1,qtyN:0,rateN:0,tax:18}]},by:'x'});
const run=(label,fn)=>{global.TR=process.argv[3]==='trace';global.BY={};READS=0;CELLS=0;WCELLS=0;const r=fn();console.log(label.padEnd(26),'ok',r.ok,'| sheet reads',READS,'| cells read',CELLS,'| cells written',WCELLS);console.log('   by sheet',JSON.stringify(global.BY));};
run('edit an old shipment',()=>api('shipment',{shipment:{shipmentId:'B5',supplier:'Sup',shipDate:'2026-10-01',status:'In Transit',lr:'LR1',allocations:[0,1,2,3].map(k=>({type:'PO',poNumber:'PO-X5',code:'C5',name:'n',qty:2+k}))},by:'x'}));
run('new shipment',()=>api('shipment',{shipment:{shipmentId:'NEW1',supplier:'Sup',shipDate:'2026-10-01',status:'In Transit',allocations:[{type:'PO',poNumber:'PO-X7',code:'C7',name:'n',qty:1}]},by:'x'}));
run('edit an old bill',()=>api('bill',{bill:{billId:'BB3',supplier:'Sup',billDate:'2026-10-02',lines:[{shipmentId:'B3',code:'C3',name:'n',qtyG:9,rateG:1,qtyN:1,rateN:1,tax:18}]},by:'x'}));
// the reply after a save must equal a fresh read (the in-request copy is updated, not re-read)
const rr=api('shipment',{shipment:{shipmentId:'B9',supplier:'Sup',shipDate:'2026-10-01',lr:'LR9',status:'In Transit',allocations:[{type:'PO',poNumber:'PO-X9',code:'C9',name:'n',qty:3}]},by:'x'});
const fr=JSON.parse(ctx.handleApi_('v11data',{},{token:'x'}));const nz=o=>JSON.stringify([o.shipments,o.shipAllocs,o.bills,o.billLines]);
console.log('reply after a save == fresh read:',nz(rr.v11data)===nz(fr),'| read cache off after the request:',ctx.V11_MEMO===null);
console.log('allocations rows',sheets['Shipment Allocations'].data.length-1,'| bill lines',sheets['Bill Lines'].data.length-1);
`);
