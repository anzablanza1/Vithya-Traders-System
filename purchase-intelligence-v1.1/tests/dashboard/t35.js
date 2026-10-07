const fs=require('fs');const {JSDOM,VirtualConsole}=require('jsdom');
const html=fs.readFileSync('VT_Purchase_Intelligence_V1_1.html','utf8').replace(/<script[^>]*src=[^>]*><\/script>/g,'');
const vc=new VirtualConsole();const errs=[];vc.on('jsdomError',e=>errs.push(String(e.message||e)));
const dom=new JSDOM(html,{runScripts:'dangerously',virtualConsole:vc,url:'https://x.test/'});
const w=dom.window;setTimeout(()=>{const ev=c=>w.eval(c);
 ev(`VT_MODE='mgmt';PODOCS=[];V11={loaded:true,shipments:[
  {shipmentId:'S1',shipmentNo:'SH-20260901-01',supplier:'Acme',status:'In Transit',shipDate:'2026-09-01',expected:'2026-09-05',lr:'L1'},
  {shipmentId:'S2',shipmentNo:'SH-20261001-01',supplier:'Beta',status:'Arrived',shipDate:'2026-10-01',arrivedAt:'2026-10-03'},
  {shipmentId:'CONV-x',shipmentNo:'SH-20260801-01',supplier:'Acme',status:'Arrived',shipDate:'2026-08-01',arrivedAt:'2026-08-02'},
  {shipmentId:'S4',shipmentNo:'SH-20261005-01',supplier:'Beta',status:'In Transit',shipDate:'2026-10-05',expected:'2099-01-01'}],
  allocs:[{shipmentId:'S1',type:'PO',canon:'A',qty:5},{shipmentId:'S1',type:'EXCESS',canon:'A',qty:2},{shipmentId:'S2',type:'PO',canon:'B',qty:50},{shipmentId:'CONV-x',type:'PO',canon:'C',qty:1},{shipmentId:'S4',type:'OFFPO',canon:'D',qty:9}],
  bills:[{billId:'B1',billNo:'BL-1',supplier:'Beta',billDate:'2026-10-03',readyAt:'2026-10-03',miG:'M1',vasyG:'V1',totalsJson:'{"wTotal":500}'},{billId:'CONVB-x',billNo:'BL-0',supplier:'Acme',billDate:'2026-08-01',totalsJson:'{"wTotal":20,"nTotal":5}'}],
  billLines:[{billId:'B1',shipmentId:'S2',canon:'B',qtyG:50,rateG:10},{billId:'CONVB-x',shipmentId:'CONV-x',canon:'C',qtyG:1,rateG:20}]};
  S11_SCOPE='all';switchScreen('ships');`);
 const rows=()=>ev(`[...document.querySelectorAll('#ships-list tbody tr')].map(r=>r.querySelector('a').textContent).join(', ')`);
 console.log('default:',rows());
 ev(`F11_OPEN=true;f11Paint('ships')`);console.log('filter bar controls:',ev(`document.querySelectorAll('#ships-fbar select,#ships-fbar input,#ships-fbar .fc').length`));
 ev(`f11Tog('ships','st','overdue')`);console.log('overdue:',rows());
 ev(`f11Clear('ships');f11Tog('ships','flags','excess')`);console.log('has excess:',rows());
 ev(`f11Clear('ships');f11Set('ships','from','2026-09-15');f11Set('ships','to','2026-10-31')`);console.log('ship date 15 Sep–31 Oct:',rows());
 ev(`f11Clear('ships');f11Tog('ships','bill','billed')`);console.log('billed in Vasy:',rows());
 ev(`f11Clear('ships');f11Tog('ships','bill','none')`);console.log('not on bill:',rows());
 ev(`f11Clear('ships');f11Set('ships','sort','qty-desc')`);console.log('qty desc:',rows());
 ev(`f11Set('ships','sup','Acme')`);console.log('Acme:',rows(),'| filters count',ev(`f11Count('ships')`));
 ev(`f11Clear('ships');f11Preset('ships','month')`);console.log('this month range:',ev(`F11.ships.from+'..'+F11.ships.to`));
 ev(`f11Clear('ships');v11ShipsView('bills')`);console.log('bills default:',rows());
 ev(`f11Set('bills','sort','val-asc')`);console.log('bills value asc:',rows());
 ev(`f11Tog('bills','st','billed')`);console.log('bills billed:',rows());
 ev(`f11Clear('bills');f11Tog('bills','flags','conv')`);console.log('bills converted:',rows());
 ev(`f11Clear('bills');f11Tog('bills','flags','wo')`);console.log('bills with wo:',rows());
 console.log('saved:',!!w.localStorage.getItem('vt_f11'),'errors',errs.slice(0,3));process.exit(0);},1500);
