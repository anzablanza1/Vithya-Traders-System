// [2.8] Operations PIN tier, edit history route, "what changed" notes on shipment / bill edits
const fs=require('fs');
eval(fs.readFileSync('hbase.js','utf8')+`
const api=(a,b)=>JSON.parse(ctx.handleApi_(a,{},Object.assign({token:'x'},b||{})));
ctx.setupShipmentsV11&&ctx.setupShipmentsV11();ctx.setupBillsV11&&ctx.setupBillsV11();
// security: ops tier
let r=api('security',{set:'mgmt',hash:'M1',salt:'s'});console.log('mgmt set:',r.ok);
r=api('security',{set:'ops',hash:'O1',authHash:'WRONG'});console.log('ops set with wrong auth:',r.ok,r.error);
r=api('security',{set:'ops',hash:'O1',authHash:'M1'});console.log('ops set:',r.ok,'| GET:',JSON.stringify(api('security',{})));
r=api('security',{set:'boss',hash:'X',authHash:'M1'});console.log('bad tier:',r.error);
// shipment create + edit
const sh={shipmentId:'S1',supplier:'Sup',shipDate:'2026-10-10',transport:'',lr:'',expected:'',status:'In Transit',note:'',
  allocations:[{type:'PO',poNumber:'PO-A',code:'111',name:'Bearing',qty:10},{type:'PO',poNumber:'PO-B',code:'333',name:'Seal',qty:5}]};
r=api('shipment',{shipment:sh,by:'Anu'});console.log('create:',r.ok,r.shipmentNo,(r.errors||[]).join(' | '));
const sh2=JSON.parse(JSON.stringify(sh));sh2.lr='LR77';sh2.expected='2026-10-15';sh2.allocations[0].qty=12;sh2.allocations.splice(1,1);sh2.allocations.push({type:'OFFPO',poNumber:'',code:'999',name:'Extra',qty:2});
r=api('shipment',{shipment:sh2,by:'Ravi',editNote:'bill showed 12'});console.log('edit:',r.ok,(r.errors||[]).join(' | '));
r=api('shipment',{shipment:sh2,by:'Ravi'});console.log('save again, no change:',r.ok);
let h=api('history',{entity:'Shipment',id:'S1'});console.log('history rows:',h.history.length);h.history.forEach(x=>console.log('  ',x.user,x.action,'|',x.note));
// bill create + edit
const b={billId:'B1',supplier:'Sup',billDate:'2026-10-11',supBillG:'INV-1',supBillN:'',roundG:0,roundN:0,charges:[],note:'',
  lines:[{shipmentId:'S1',code:'111',name:'Bearing',qtyG:12,rateG:100,qtyN:0,rateN:0,tax:18,mrpG:150,spG:140}]};
r=api('bill',{bill:b,by:'Anu'});console.log('bill create:',r.ok,r.billNo,(r.errors||[]).join(' | '));
const b2=JSON.parse(JSON.stringify(b));b2.supBillG='INV-1A';b2.lines[0].rateG=105;b2.lines[0].qtyG=10;b2.lines[0].qtyN=2;b2.lines[0].rateN=90;b2.charges=[{name:'Freight',amount:50,lane:'g',gst:18}];
r=api('bill',{bill:b2,by:'Ravi',editNote:'rate corrected'});console.log('bill edit:',r.ok);
h=api('history',{entity:'Bill',id:'B1'});h.history.forEach(x=>console.log('  ',x.user,x.action,'|',x.note));
console.log('history wrong entity:',api('history',{entity:'Bill',id:'S1'}).history.length,'| unknown id:',api('history',{id:'NOPE'}).history.length,'| no id:',api('history',{}).error);
`);
